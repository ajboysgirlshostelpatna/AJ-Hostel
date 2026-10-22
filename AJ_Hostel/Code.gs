const HOSTEL_NAME = "AJ Boys & Girls Hostel";
const OWNER_EMAIL = "ajboysgirlshostelpatna@gmail.com";
const SPREADSHEET_ID = "1LpMbXb3WzMJ_Lx7H1yIbbDCoc3sptPCTH-IYluRsfdc";
const SHEET_NAME = "Enquiries";
const HEADERS = [
  "Submitted at",
  "Request ID",
  "Name",
  "Role",
  "Phone",
  "Email",
  "Room preference",
  "Expected joining date",
  "Enquiry status",
  "Email status"
];

function setupSpreadsheet() {
  const spreadsheet = openSpreadsheet_();
  const sheet = getEnquiriesSheet_(spreadsheet);
  MailApp.getRemainingDailyQuota();
  console.log("Sheet is ready: " + spreadsheet.getUrl() + " (#" + sheet.getSheetId() + ")");
}

function doPost(event) {
  const params = event && event.parameter ? event.parameter : {};
  const requestId = String(params.requestId || "").trim();

  if(!isRequestId_(requestId)) {
    return responsePage_({status: "invalid", requestId: requestId});
  }
  if(String(params.website || "").trim()) {
    return responsePage_({status: "spam", requestId: requestId});
  }

  const formStartedAt = Number(params.formStartedAt);
  const elapsed = Date.now() - formStartedAt;
  if(!Number.isFinite(formStartedAt) || elapsed < 1200 || elapsed > 86400000) {
    return responsePage_({status: "spam", requestId: requestId});
  }

  const enquiry = validateEnquiry_(params);
  if(!enquiry) {
    return responsePage_({status: "invalid", requestId: requestId});
  }

  let sheet;
  let row;
  let duplicate = false;
  let rateLimited = false;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    sheet = getEnquiriesSheet_(openSpreadsheet_());
    const existingRow = findRequestRow_(sheet, requestId);
    if(existingRow) {
      row = existingRow;
      duplicate = true;
    } else {
      const cache = CacheService.getScriptCache();
      const contactKey = contactCacheKey_(enquiry);
      if(cache.get(contactKey)) {
        rateLimited = true;
      } else {
        row = sheet.getLastRow() + 1;
        sheet.appendRow([
          new Date(),
          requestId,
          sheetSafe_(enquiry.name),
          sheetSafe_(enquiry.who),
          sheetSafe_(enquiry.phone),
          sheetSafe_(enquiry.email),
          sheetSafe_(enquiry.room),
          sheetSafe_(enquiry.date),
          "received",
          "pending"
        ]);
        try {
          cache.put(contactKey, "1", 30);
        } catch(cacheError) {
          console.error("Could not set the short spam-throttle cache: " + cacheError);
        }
      }
    }
  } catch(error) {
    console.error("Could not save enquiry: " + error);
    return responsePage_({status: "backend_error", requestId: requestId});
  } finally {
    if(lock.hasLock()) lock.releaseLock();
  }

  if(rateLimited) {
    return responsePage_({status: "rate_limited", requestId: requestId});
  }

  if(duplicate) {
    let emailStatus;
    try {
      emailStatus = String(sheet.getRange(row, 10).getDisplayValue());
    } catch(error) {
      console.error("Could not read the saved enquiry status: " + error);
      return responsePage_({status: "duplicate_status_unknown", requestId: requestId});
    }
    const status = emailStatus === "sent"
      ? "duplicate_saved"
      : emailStatus === "failed" ? "duplicate_email_failed" : "duplicate_pending";
    return responsePage_({status: status, requestId: requestId});
  }

  let emailSent = false;
  try {
    MailApp.sendEmail({
      to: OWNER_EMAIL,
      subject: "New hostel enquiry — " + enquiry.name,
      body: emailBody_(enquiry)
    });
    emailSent = true;
  } catch(error) {
    console.error("Enquiry saved, but email notification failed: " + error);
    try {
      sheet.getRange(row, 10).setValue("failed");
    } catch(statusError) {
      console.error("Could not update email status for saved enquiry: " + statusError);
    }
    return responsePage_({status: "saved_email_failed", requestId: requestId});
  }

  if(emailSent) {
    try {
      sheet.getRange(row, 10).setValue("sent");
      return responsePage_({status: "saved", requestId: requestId});
    } catch(error) {
      console.error("Enquiry and email sent, but email status could not be recorded: " + error);
      return responsePage_({status: "saved_status_unknown", requestId: requestId});
    }
  }
}

function validateEnquiry_(params) {
  const name = cleanText_(params.name, 100);
  const who = cleanText_(params.who, 40);
  const phone = cleanText_(params.phone, 30);
  const email = cleanText_(params.email, 254).toLowerCase();
  const room = cleanText_(params.room, 60);
  const date = cleanText_(params.date, 10);
  const normalizedPhone = phone.replace(/[\s()-]/g, "");
  const validPhone = /^(\+?91)?[6-9]\d{9}$/.test(normalizedPhone);
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const parsedDate = new Date(date + "T00:00:00Z");
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(parsedDate.getTime()) &&
    Utilities.formatDate(parsedDate, "UTC", "yyyy-MM-dd") === date &&
    date >= today;

  if(!name || !["Student", "Parent / Guardian"].includes(who) ||
     !validPhone || !validEmail ||
     !["Single Room", "Double-Sharing Room", "Shared Room", "Not sure yet"].includes(room) ||
     !validDate) {
    return null;
  }

  return {name: name, who: who, phone: normalizedPhone, email: email, room: room, date: date};
}

function cleanText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isRequestId_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function contactCacheKey_(enquiry) {
  const source = enquiry.phone + "|" + enquiry.email;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source);
  return "contact:" + Utilities.base64EncodeWebSafe(digest);
}

function sheetSafe_(value) {
  return /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
}

function emailBody_(enquiry) {
  return [
    "A new enquiry was submitted on the " + HOSTEL_NAME + " website.",
    "",
    "Name: " + enquiry.name,
    "Role: " + enquiry.who,
    "Phone: " + enquiry.phone,
    "Email: " + enquiry.email,
    "Room preference: " + enquiry.room,
    "Expected joining date: " + enquiry.date,
    "",
    "This is an enquiry only, not a confirmed booking."
  ].join("\n");
}


function openSpreadsheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === "PASTE_YOUR_GOOGLE_SHEET_ID_HERE") {
    throw new Error("Set SPREADSHEET_ID in Code.gs before deployment.");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getEnquiriesSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if(!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

  if(sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    const actualHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
    if(HEADERS.some(function(header, index) { return actualHeaders[index] !== header; })) {
      throw new Error("The Enquiries sheet headers do not match the expected columns.");
    }
  }
  return sheet;
}

function findRequestRow_(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if(lastRow < 2) return 0;
  const match = sheet.getRange(2, 2, lastRow - 1, 1)
    .createTextFinder(requestId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function responsePage_(result) {
  const message = JSON.stringify(Object.assign({channel: "aj-hostel-enquiry"}, result))
    .replace(/</g, "\\u003c");
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>window.top.postMessage(' + message + ', "*");</script>' +
    '<p>Enquiry response received. You may close this page.</p></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
