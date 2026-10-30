
'use strict';

/* ============================================================
   SCAN2EXCEL — COMPLETE SCRIPT.JS
   Features:
   1. Image upload and camera
   2. Image preprocessing and OCR
   3. Editable VPC data tables
   4. Google OAuth
   5. New spreadsheet for every save
   6. Professional Google Sheets formatting
   7. Automatic spreadsheet opening
   8. JSON backup
   ============================================================ */


/* ============================================================
   SECTION 1: GOOGLE OAUTH AND GLOBAL VARIABLES
   ============================================================ */

const GOOGLE_CLIENT_ID =
    '292133242401-ag0gdtmorgahhvu75q5kdflf21ig3fk9.apps.googleusercontent.com';

const GOOGLE_SHEETS_SCOPE =
    'openid email https://www.googleapis.com/auth/spreadsheets';

let googleTokenClient = null;
let googleAccessToken = null;
let connectedGoogleEmail = '';
let currentFile = null;
let previewURL = null;
let isExtracting = false;

/* ==========================================
   IMAGE ROTATION STATE
   ========================================== */

let originalFileForRotation = null;
let rotationDegrees = 0;
const $ = id => document.getElementById(id);
const rotateImageButton = $('rotateImageButton');
let isSaving = false;
let pendingSheetWindow = null;




/* ============================================================
   SECTION 2: HTML ELEMENT REFERENCES
   ============================================================ */

const browseButton = $('browseButton');
const cameraButton = $('cameraButton');
const documentInput = $('documentInput');
const uploadSection = document.querySelector('.upload-section');
const documentPreview = $('documentPreview');
const clearScanButton = $('clearScanButton');
const extractDataButton = $('extractDataButton');
const saveDataButton = $('saveDataButton');
const exportSheetsButton = $('exportSheetsButton');

const statusMessage = $('statusMessage');
const rawOcrContainer = $('rawOcrContainer');
const rawOcrText = $('rawOcrText');

const googleSignInButton = $('googleSignInButton');
const googleAccountStatus = $('googleAccountStatus');
const sheetUrlStatus = $('sheetUrlStatus');


/* ============================================================
   SECTION 3: STATUS MESSAGES
   ============================================================ */

function setStatus(message) {
    if (statusMessage) {
        statusMessage.textContent = message;
    }
}

function setGoogleStatus(message, error = false) {
    if (!googleAccountStatus) return;

    googleAccountStatus.textContent = message;
    googleAccountStatus.classList.toggle('status-error', error);
    googleAccountStatus.classList.toggle('status-success', !error);
}

function setSheetStatus(message, error = false) {
    if (!sheetUrlStatus) return;

    sheetUrlStatus.textContent = message;
    sheetUrlStatus.classList.toggle('status-error', error);
    sheetUrlStatus.classList.toggle('status-success', !error);    
}


/* ============================================================
   SECTION 4: IMAGE UPLOAD AND CAMERA
   ============================================================ */

function openPicker(useCamera = false) {
    if (!documentInput) {
        setStatus('Image input was not found in the HTML.');
        return;
    }

    documentInput.accept = 'image/*';

    if (useCamera) {
        documentInput.setAttribute('capture', 'environment');
    } else {
        documentInput.removeAttribute('capture');
    }

    documentInput.click();
}

browseButton?.addEventListener('click', () => openPicker(false));
cameraButton?.addEventListener('click', () => openPicker(true));

function selectImageFile(file) {
    if (isExtracting) {
        setStatus('Please wait for extraction to finish before changing the image.');
        return;
    }

    if (!file.type.startsWith('image/')) {
        setStatus('Please select a valid image.');
        if (documentInput) documentInput.value = '';
        return;
    }

    if (previewURL) {
        URL.revokeObjectURL(previewURL);
    }

    originalFileForRotation = file;
    currentFile = file;
    rotationDegrees = 0;

    if (rotateImageButton) {
        rotateImageButton.disabled = false;
    }
    if (clearScanButton) {
        clearScanButton.disabled = false;
    }

    previewURL = URL.createObjectURL(file);

    if (documentPreview) {
        documentPreview.src = previewURL;
        documentPreview.hidden = false;
        documentPreview.style.display = 'block';
    }

    if (documentInput) {
        documentInput.value = '';
    }

    setStatus('Image selected. Click Extract Data.');
}

documentInput?.addEventListener('change', () => {
    const file = documentInput.files?.[0];
    if (file) selectImageFile(file);
});

uploadSection?.addEventListener('dragover', event => {
    event.preventDefault();
    if (!isExtracting) {
        uploadSection.classList.add('is-dragging');
    }
});

uploadSection?.addEventListener('dragleave', event => {
    if (!event.relatedTarget || !uploadSection.contains(event.relatedTarget)) {
        uploadSection.classList.remove('is-dragging');
    }
});

uploadSection?.addEventListener('drop', event => {
    event.preventDefault();
    uploadSection.classList.remove('is-dragging');

    const file = event.dataTransfer?.files?.[0];
    if (!file) {
        setStatus('No file was found. Drop an image to upload it.');
        return;
    }

    selectImageFile(file);
});

function clearCurrentScan() {
    const confirmed = window.confirm(
        'Clear the selected image, extracted values, and any edits?'
    );

    if (!confirmed) return;

    currentFile = null;
    originalFileForRotation = null;
    rotationDegrees = 0;

    if (previewURL) {
        URL.revokeObjectURL(previewURL);
        previewURL = null;
    }

    if (documentInput) {
        documentInput.value = '';
    }
    if (documentPreview) {
        documentPreview.removeAttribute('src');
        documentPreview.hidden = true;
        documentPreview.style.removeProperty('display');
    }
    if (rotateImageButton) {
        rotateImageButton.disabled = true;
    }
    if (clearScanButton) {
        clearScanButton.disabled = true;
    }

    [
        'extractedDataBody',
        'contractorDataBody',
        'workDataBody',
        'paymentSummaryBody',
        'recoveryDataBody'
    ].forEach(id => $(id)?.replaceChildren());

    if (rawOcrText) rawOcrText.value = '';
    if (rawOcrContainer) {
        rawOcrContainer.hidden = true;
        rawOcrContainer.open = false;
    }

    setStatus('Current scan and extracted data cleared.');
}

clearScanButton?.addEventListener('click', clearCurrentScan);


/* ============================================================
   SECTION 5: IMAGE PREPROCESSING
   Improves contrast before OCR.
   ============================================================ */

function cleanText(value) {
    return String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

async function preprocessImage(file) {
    const imageURL = URL.createObjectURL(file);

    try {
        const image = new Image();

        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () =>
                reject(new Error('Could not load the selected image.'));
            image.src = imageURL;
        });

        const scale = Math.min(
            2,
            2600 / Math.max(image.width, image.height)
        );

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext('2d', {
            willReadFrequently: true
        });

        if (!context) {
            throw new Error('Could not process the image.');
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const imageData = context.getImageData(
            0, 0, canvas.width, canvas.height
        );

        const pixels = imageData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            const gray =
                0.299 * pixels[i] +
                0.587 * pixels[i + 1] +
                0.114 * pixels[i + 2];

            const enhanced = Math.max(
                0,
                Math.min(255, (gray - 128) * 1.35 + 128)
            );

            pixels[i] = enhanced;
            pixels[i + 1] = enhanced;
            pixels[i + 2] = enhanced;
        }

        context.putImageData(imageData, 0, 0);

        return await new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Could not improve image quality.'));
                }
            }, 'image/png');
        });
    } finally {
        URL.revokeObjectURL(imageURL);
    }
}


/* ============================================================
   SECTION 6: VPC FIELD DEFINITIONS
   ============================================================ */

const FIELDS = {
    document: [
        'Project',
        'Work Order Number',
        'Work Order Date',
        'Work Order Value',
        'Reference Quotation/WO',
        'VPC Number',
        'VPC Date',
        'VPC Period',
        'Bill Number'
    ],

    contractor: [
        'Contractor',
        'Address',
        'Phone',
        'PAN',
        'GST Number',
        'Executed By',
        'Bank Name',
        'Account Number',
        'Branch',
        'IFSC'
    ],

    work: [
        'Description of Items',
        'Unit',
        'Rate',
        'Work Order Quantity',
        'Previous VPC Quantity',
        'Current VPC Quantity',
        'Up-to-Date VPC Quantity',
        'Current VPC Amount',
        'Cumulative VPC Amount'
    ]
};

const PAYMENT_FIELDS = [
    'Total Certified Amount',
    'Service Tax',
    'VAT',
    'GST Provider Amt',
    'Other Charges',
    'Credits',
    'Subtotal A',
    'Security Deposit (SD) - Retention',
    'TDS',
    'Advance Recovered',
    'Debit / Discount',
    'Subtotal B',
    'Total Payments (A-B)',
    'Net Payable Amount'
];


/* ============================================================
   SECTION 7: OCR FIELD EXTRACTION HELPERS
   ============================================================ */

function normalize(value) {
    return cleanText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function extractLabelValue(text, field) {
    const aliases = {
        'Work Order Number': [
            'work order no',
            'work order number',
            'wo no'
        ],
        'VPC Number': ['vpc no', 'vpc number'],
        'Bill Number': ['bill no', 'bill number'],
        'Account Number': ['a/c no', 'account no', 'account number'],
        'GST Number': ['gst no', 'gst number', 'gstin'],
        'Reference Quotation/WO': [
            'reference quotation/wo',
            'reference quotation',
            'quotation no'
        ],
        'Work Order Quantity': ['wo qty', 'work order quantity'],
        'Previous VPC Quantity': ['previous vpc qty'],
        'Current VPC Quantity': ['current vpc qty'],
        'Up-to-Date VPC Quantity': [
            'upto date vpc qty',
            'up to date vpc qty'
        ],
        'Current VPC Amount': ['current vpc amt'],
        'Cumulative VPC Amount': ['cumulative vpc amt']
    };

    const lines = String(text || '')
        .split(/\r?\n/)
        .map(cleanText)
        .filter(Boolean);

    const labels = aliases[field] || [field];

    for (let i = 0; i < lines.length; i++) {
        for (const label of labels) {
            const escaped = label.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            const regex = new RegExp(
                '(?:^|\\b)' + escaped + '\\s*[:：-]?\\s*(.*)',
                'i'
            );

            const match = lines[i].match(regex);

            if (!match) continue;

            const value = cleanText(match[1]);

            if (value && normalize(value) !== normalize(field)) {
                return value;
            }

            if (lines[i + 1]) {
                return lines[i + 1];
            }
        }
    }

    return '';
}

function findPaymentValues(text, field) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map(cleanText)
        .filter(Boolean);

    const target = normalize(field);

    for (const line of lines) {
        if (!normalize(line).includes(target)) continue;

        const numbers =
            line.match(/-?\d[\d,]*(?:\.\d{1,2})?/g) || [];

        if (numbers.length >= 3) {
            return {
                field,
                previous: numbers[numbers.length - 3],
                current: numbers[numbers.length - 2],
                cumulative: numbers[numbers.length - 1]
            };
        }
    }

    return {
        field,
        previous: '',
        current: '',
        cumulative: ''
    };
}


/* ============================================================
   SECTION 8: RENDER EDITABLE KEY-VALUE TABLES
   ============================================================ */

function renderKeyValueTable(tbodyId, items) {
    const tbody = $(tbodyId);
    if (!tbody) return;

    tbody.replaceChildren();

    items.forEach(item => {
        const row = document.createElement('tr');
        const label = document.createElement('td');0
        const valueCell = document.createElement('td');
        const input = document.createElement('input');

        label.textContent = item.field;

        input.type = 'text';
        input.className = 'table-input';
        input.dataset.field = item.field;
        input.value = item.value || '';
        input.placeholder = 'Review or enter value';

        if (!input.value.trim()) {
            input.classList.add('needs-review');
        }

        input.addEventListener('input', () => {
            input.classList.toggle(
                'needs-review',
                !input.value.trim()
            );
        });

        valueCell.appendChild(input);
        row.append(label, valueCell);
        tbody.appendChild(row);
    });
}


/* ============================================================
   SECTION 9: RENDER PAYMENT AND RECOVERY TABLES
   ============================================================ */

function renderPaymentTable(tbodyId, items) {
    const tbody = $(tbodyId);
    if (!tbody) return;

    tbody.replaceChildren();

    items.forEach(item => {
        const row = document.createElement('tr');
        const descriptionCell = document.createElement('td');
        const description = document.createElement('input');

        description.type = 'text';
        description.className = 'table-input table-input-desc';
        description.dataset.col = 'field';
        description.value = item.field;

        descriptionCell.appendChild(description);
        row.appendChild(descriptionCell);

        ['previous', 'current', 'cumulative'].forEach(column => {
            const cell = document.createElement('td');
            const input = document.createElement('input');

            input.type = 'text';
            input.className = 'table-input table-input-num';
            input.dataset.col = column;
            input.value = item[column] || '';
            input.placeholder = 'Review';

            if (!input.value.trim()) {
                input.classList.add('needs-review');
            }

            input.addEventListener('input', () => {
                input.classList.toggle(
                    'needs-review',
                    !input.value.trim()
                );
            });

            cell.appendChild(input);
            row.appendChild(cell);
        });

        tbody.appendChild(row);
    });
}


/* ============================================================
   SECTION 10: EXTRACT VPC DATA INTO THE HTML TABLES
   ============================================================ */

function extractVPCData(text) {
    renderKeyValueTable(
        'extractedDataBody',
        FIELDS.document.map(field => ({
            field,
            value: extractLabelValue(text, field)
        }))
    );

    renderKeyValueTable(
        'contractorDataBody',
        FIELDS.contractor.map(field => ({
            field,
            value: extractLabelValue(text, field)
        }))
    );

    renderKeyValueTable(
        'workDataBody',
        FIELDS.work.map(field => ({
            field,
            value: extractLabelValue(text, field)
        }))
    );

    const payments = PAYMENT_FIELDS.map(
        field => findPaymentValues(text, field)
    );

    renderPaymentTable(
        'paymentSummaryBody',
        payments.filter(item => [
            'Total Certified Amount',
            'Service Tax',
            'VAT',
            'GST Provider Amt',
            'Other Charges',
            'Credits',
            'Subtotal A'
        ].includes(item.field))
    );

    renderPaymentTable(
        'recoveryDataBody',
        payments.filter(item => [
            'Security Deposit (SD) - Retention',
            'TDS',
            'Advance Recovered',
            'Debit / Discount',
            'Subtotal B',
            'Total Payments (A-B)',
            'Net Payable Amount'
        ].includes(item.field))
    );
}


/* ============================================================
   SECTION 11: RUN OCR
   ============================================================ */

async function extractTextFromImage(file) {
    if (typeof Tesseract === 'undefined') {
        throw new Error(
            'Tesseract.js did not load. Check your internet connection.'
        );
    }

    setStatus('Improving image quality...');
    

    const processedImage = await preprocessImage(file);

    setStatus('Reading VPC document...');

    const result = await Tesseract.recognize(
        processedImage,
        'eng',
        {
            logger: message => {
                if (message.status === 'recognizing text') {
                    const percent = Math.round(
                        (message.progress || 0) * 100
                    );

                    setStatus('Reading document... ' + percent + '%');
                }
            }
        }
    );

    const text = String(result?.data?.text || '').trim();

    if (rawOcrText) rawOcrText.value = text;
    if (rawOcrContainer) rawOcrContainer.hidden = false;

    if (!text) {
        setStatus('No text detected. Try a clearer image.');
        return;
    }

    extractVPCData(text);
    setStatus('Extraction completed. Verify every value before saving.');
}

extractDataButton?.addEventListener('click', async event => {
    event.preventDefault();

    const file = currentFile || documentInput?.files?.[0];

    if (!file) {
        setStatus('Please browse or scan a VPC image first.');
        return;
    }

    extractDataButton.disabled = true;
    isExtracting = true;
    if (clearScanButton) clearScanButton.disabled = true;
    if (browseButton) browseButton.disabled = true;
    if (cameraButton) cameraButton.disabled = true;

    try {
        await extractTextFromImage(file);
    } catch (error) {
        console.error('OCR error:', error);
        setStatus('OCR error: ' + error.message);
    } finally {
        isExtracting = false;
        extractDataButton.disabled = false;
        if (clearScanButton) clearScanButton.disabled = !currentFile;
        if (browseButton) browseButton.disabled = false;
        if (cameraButton) cameraButton.disabled = false;
    }
});


/* ============================================================
   SECTION 12: COLLECT EDITED DATA FROM THE HTML TABLES
   ============================================================ */

function collectKeyValueTable(tbodyId) {
    const data = {};

    $(tbodyId)?.querySelectorAll('input[data-field]')
        .forEach(input => {
            data[input.dataset.field] = input.value.trim();
        });

    return data;
}

function collectPaymentTable(tbodyId) {
    const rows = [];

    $(tbodyId)?.querySelectorAll('tr').forEach(row => {
        const field = row.querySelector('[data-col="field"]');
        if (!field) return;

        rows.push({
            field: field.value.trim(),
            previous:
                row.querySelector('[data-col="previous"]')?.value.trim() || '',
            current:
                row.querySelector('[data-col="current"]')?.value.trim() || '',
            cumulative:
                row.querySelector('[data-col="cumulative"]')?.value.trim() || ''
        });
    });

    return rows;
}

function collectVPCData() {
    return {
        documentInfo: collectKeyValueTable('extractedDataBody'),
        contractorDetails: collectKeyValueTable('contractorDataBody'),
        workDetails: collectKeyValueTable('workDataBody'),
        paymentSummary: collectPaymentTable('paymentSummaryBody'),
        recoveries: collectPaymentTable('recoveryDataBody'),
        savedAt: new Date().toISOString()
    };
}


/* ============================================================
   SECTION 13: DOWNLOAD JSON BACKUP
   ============================================================ */

saveDataButton?.addEventListener('click', () => {
    const data = collectVPCData();

    const blob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'Scan2Excel-VPC.json';
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setStatus('Verified data downloaded as JSON.');
});


/* ============================================================
   SECTION 14: GOOGLE OAUTH
   ============================================================ */

function initializeGoogleTokenClient() {
    if (!window.google?.accounts?.oauth2) {
        throw new Error(
            'Google sign-in library is not loaded. Refresh and try again.'
        );
    }

    googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SHEETS_SCOPE,

        callback: async response => {
            try {
                if (response.error) {
                    googleAccessToken = null;
                    setGoogleStatus(
                        'Google sign-in failed: ' + response.error,
                        true
                    );
                    return;
                }

                if (!response.access_token) {
                    throw new Error('No Google access token was received.');
                }

                googleAccessToken = response.access_token;

                const userResponse = await fetch(
                    'https://www.googleapis.com/oauth2/v3/userinfo',
                    {
                        headers: {
                            Authorization: 'Bearer ' + googleAccessToken
                        }
                    }
                );

                const user = await userResponse.json();

                if (!userResponse.ok || !user.email) {
                    throw new Error(
                        user.error?.message ||
                        'Could not identify the Google account.'
                    );
                }

                connectedGoogleEmail = user.email;

                setGoogleStatus('Connected: ' + connectedGoogleEmail);
                setStatus('Google account connected.');
                setSheetStatus('Ready to save a new VPC spreadsheet.');

            } catch (error) {
                console.error('Google OAuth error:', error);
                setGoogleStatus(error.message, true);
                setStatus('Google connection error: ' + error.message);
            }
        },

        error_callback: error => {
            console.error('Google popup error:', error);
            setGoogleStatus(
                'Sign-in popup failed. Check browser popup settings.',
                true
            );
        }
    });
}

googleSignInButton?.addEventListener('click', () => {
    try {
        initializeGoogleTokenClient();

        googleTokenClient.requestAccessToken({
            prompt: 'consent'
        });
    } catch (error) {
        console.error(error);
        setGoogleStatus(error.message, true);
    }
});


/* ============================================================
   SECTION 15: BUILD THE PROFESSIONAL VPC REPORT
   ============================================================ */

function buildVPCSheet(data) {
    const rows = [];
    const sectionRows = [];
    const headerRows = [];
    const highlightRows = [];

    const addRow = (...values) => {
        rows.push(values);
        return rows.length - 1;
    };

    const addSection = title => {
        const index = addRow(title);
        sectionRows.push(index);
    };

    const addTableHeader = (...values) => {
        const index = addRow(...values);
        headerRows.push(index);
    };

    const addKeyValueSection = (title, values) => {
        addRow();
        addSection(title);
        addTableHeader('Field', 'Value');

        Object.entries(values || {}).forEach(([field, value]) => {
            const index = addRow(field, value ?? '');

            if ([
                'VPC Number',
                'Contractor',
                'Total Certified Amount',
                'Net Payable Amount'
            ].includes(field)) {
                highlightRows.push(index);
            }
        });
    };

    addRow('SCAN2EXCEL - VPC PAYMENT REPORT');
    addRow('Saved At', data.savedAt);
    addRow();

    addKeyValueSection('DOCUMENT INFORMATION', data.documentInfo);
    addKeyValueSection('CONTRACTOR & BANK DETAILS', data.contractorDetails);
    addKeyValueSection('WORK DETAILS', data.workDetails);

    addRow();
    addSection('PAYMENT SUMMARY');

    addTableHeader(
        'Description',
        'Previous',
        'Current',
        'Cumulative'
    );

    (data.paymentSummary || []).forEach(item => {
        const index = addRow(
            item.field,
            item.previous,
            item.current,
            item.cumulative
        );

        if (item.field === 'Total Certified Amount') {
            highlightRows.push(index);
        }
    });

    addRow();
    addSection('RECOVERIES & NET PAYABLE');

    addTableHeader(
        'Description',
        'Previous',
        'Current',
        'Cumulative'
    );

    (data.recoveries || []).forEach(item => {
        const index = addRow(
            item.field,
            item.previous,
            item.current,
            item.cumulative
        );

        if (item.field === 'Net Payable Amount') {
            highlightRows.push(index);
        }
    });

    addRow();
    addRow('END OF VPC REPORT');

    return {
        rows,
        sectionRows,
        headerRows,
        highlightRows
    };
}


/* ============================================================
   SECTION 16: FORMAT THE GOOGLE SPREADSHEET
   ============================================================ */

async function formatVPCSpreadsheet(spreadsheetId, sheetId, layout) {
    const lastRow = layout.rows.length;
    const lastColumn = 9;

    const darkGreen = { red: 0.07, green: 0.38, blue: 0.25 };
    const lightGreen = { red: 0.85, green: 0.94, blue: 0.88 };
    const paleYellow = { red: 1, green: 0.96, blue: 0.76 };
    const white = { red: 1, green: 1, blue: 1 };
    const borderColor = { red: 0.78, green: 0.87, blue: 0.81 };

    const requests = [];

    // Base font, wrapping, alignment and borders.
    requests.push({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: lastRow,
                startColumnIndex: 0,
                endColumnIndex: lastColumn
            },
            cell: {
                userEnteredFormat: {
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat: {
                        fontSize: 10,
                        foregroundColor: {
                            red: 0.15,
                            green: 0.18,
                            blue: 0.16
                        }
                    },
                    borders: {
                        top: { style: 'SOLID', color: borderColor },
                        bottom: { style: 'SOLID', color: borderColor },
                        left: { style: 'SOLID', color: borderColor },
                        right: { style: 'SOLID', color: borderColor }
                    }
                }
            },
            fields: 'userEnteredFormat'
        }
    });

    // Main title.
    requests.push({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: lastColumn
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: darkGreen,
                    textFormat: {
                        bold: true,
                        fontSize: 16,
                        foregroundColor: white
                    },
                    verticalAlignment: 'MIDDLE'
                }
            },
            fields: 'userEnteredFormat'
        }
    });

    requests.push({
        mergeCells: {
            range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: lastColumn
            },
            mergeType: 'MERGE_ALL'
        }
    });

    requests.push({
        updateDimensionProperties: {
            range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: 0,
                endIndex: 1
            },
            properties: { pixelSize: 42 },
            fields: 'pixelSize'
        }
    });

    // Section headings.
    layout.sectionRows.forEach(rowIndex => {
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 0,
                    endColumnIndex: lastColumn
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: darkGreen,
                        textFormat: {
                            bold: true,
                            fontSize: 11,
                            foregroundColor: white
                        },
                        verticalAlignment: 'MIDDLE'
                    }
                },
                fields: 'userEnteredFormat'
            }
        });

        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 0,
                    endColumnIndex: lastColumn
                },
                mergeType: 'MERGE_ALL'
            }
        });

        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: rowIndex,
                    endIndex: rowIndex + 1
                },
                properties: { pixelSize: 30 },
                fields: 'pixelSize'
            }
        });
    });

    // Table header rows.
    layout.headerRows.forEach(rowIndex => {
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 0,
                    endColumnIndex: 4
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: lightGreen,
                        textFormat: {
                            bold: true,
                            foregroundColor: darkGreen
                        },
                        horizontalAlignment: 'CENTER',
                        wrapStrategy: 'WRAP'
                    }
                },
                fields: 'userEnteredFormat'
            }
        });
    });

    // Important fields.
    layout.highlightRows.forEach(rowIndex => {
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 0,
                    endColumnIndex: 4
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: paleYellow,
                        textFormat: {
                            bold: true,
                            foregroundColor: darkGreen
                        }
                    }
                },
                fields: 'userEnteredFormat'
            }
        });
    });

    // Blank rows provide spacing between sections.
    layout.rows.forEach((row, index) => {
        if (row.length === 0) {
            requests.push({
                updateDimensionProperties: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: index,
                        endIndex: index + 1
                    },
                    properties: { pixelSize: 12 },
                    fields: 'pixelSize'
                }
            });
        }
    });

    // Readable column widths.
    const widths = [245, 180, 125, 125, 140, 140, 140, 155, 165];

    widths.forEach((width, columnIndex) => {
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: columnIndex,
                    endIndex: columnIndex + 1
                },
                properties: { pixelSize: width },
                fields: 'pixelSize'
            }
        });
    });

    // Freeze the report title and saved-at row.
    requests.push({
        updateSheetProperties: {
            properties: {
                sheetId,
                gridProperties: { frozenRowCount: 2 }
            },
            fields: 'gridProperties.frozenRowCount'
        }
    });

    const response = await fetch(
        'https://sheets.googleapis.com/v4/spreadsheets/' +
        encodeURIComponent(spreadsheetId) +
        ':batchUpdate',
        {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + googleAccessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requests })
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.error?.message ||
            'The spreadsheet was created, but formatting failed.'
        );
    }
}


/* ============================================================
   SECTION 17: CREATE A NEW SPREADSHEET, SAVE AND OPEN IT
   Every save creates a separate Google spreadsheet.
   ============================================================ */

async function saveToGoogleSheets() {
    if (!googleAccessToken || !connectedGoogleEmail) {
        throw new Error('Please connect your Google account first.');
    }

    const data = collectVPCData();

    const vpcNumber =
        data.documentInfo['VPC Number']?.trim() || 'VPC-Unknown';

    // Remove characters unsuitable for a clean file name.
    const safeVPCNumber = vpcNumber
        .replace(/[\\/:*?"<>|]/g, '-')
        .trim();

    const dateLabel = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).format(new Date());

    const spreadsheetTitle = safeVPCNumber + ' — ' + dateLabel;

    setSheetStatus('Creating a new VPC spreadsheet...');

    // Step 1: Create a brand-new spreadsheet.
    const createResponse = await fetch(
        'https://sheets.googleapis.com/v4/spreadsheets',
        {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + googleAccessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                properties: { title: spreadsheetTitle },
                sheets: [{
                    properties: {
                        title: 'VPC Report',
                        gridProperties: { frozenRowCount: 2 }
                    }
                }]
            })
        }
    );

    const created = await createResponse.json();

    if (!createResponse.ok || !created.spreadsheetId) {
        if (createResponse.status === 401) {
            googleAccessToken = null;
        }

        throw new Error(
            created.error?.message ||
            'Could not create the new spreadsheet.'
        );
    }

    const spreadsheetId = created.spreadsheetId;
    const sheetId = created.sheets?.[0]?.properties?.sheetId;

    if (sheetId === undefined || sheetId === null) {
        throw new Error('The new spreadsheet sheet ID was not returned.');
    }

    const spreadsheetUrl =
        'https://docs.google.com/spreadsheets/d/' +
        spreadsheetId +
        '/edit';

    // Step 2: Build the report rows.
    const layout = buildVPCSheet(data);

    // Step 3: Write the data.
    setSheetStatus('Writing VPC data...');

    const range = "'VPC Report'!A1:I" + layout.rows.length;

    const writeResponse = await fetch(
        'https://sheets.googleapis.com/v4/spreadsheets/' +
        encodeURIComponent(spreadsheetId) +
        '/values/' +
        encodeURIComponent(range) +
        '?valueInputOption=USER_ENTERED',
        {
            method: 'PUT',
            headers: {
                Authorization: 'Bearer ' + googleAccessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                majorDimension: 'ROWS',
                values: layout.rows
            })
        }
    );

    const writeResult = await writeResponse.json();

    if (!writeResponse.ok) {
        throw new Error(
            writeResult.error?.message ||
            'The spreadsheet was created, but writing data failed.'
        );
    }

    // Step 4: Format the report.
    setSheetStatus('Applying professional formatting...');

    await formatVPCSpreadsheet(spreadsheetId, sheetId, layout);

    // Step 5: Remember the latest spreadsheet for this browser.
    // This ID is not reused when creating the next spreadsheet.
    localStorage.setItem(
        'scan2excel_last_spreadsheet_' + connectedGoogleEmail.toLowerCase(),
        spreadsheetId
    );

    // Step 6: Open the spreadsheet in the tab prepared by the click handler.
    setSheetStatus('VPC saved and formatted successfully.');
    setStatus('VPC saved to ' + spreadsheetTitle + '.');

    if (pendingSheetWindow && !pendingSheetWindow.closed) {
        pendingSheetWindow.location.href = spreadsheetUrl;
    } else {
        setStatus(
            'VPC saved successfully. Allow pop-ups to open the spreadsheet.'
        );
    }

    pendingSheetWindow = null;

    return {
        spreadsheetId,
        spreadsheetUrl,
        spreadsheetTitle
    };
}


/* ============================================================
   SECTION 18: GOOGLE SHEETS SAVE BUTTON
   Opens a tab synchronously to reduce popup-blocker problems.
   ============================================================ */

exportSheetsButton?.addEventListener('click', async event => {
    event.preventDefault();

    if (isSaving) return;

    if (!googleAccessToken || !connectedGoogleEmail) {
        setStatus('Please connect your Google account first.');
        setGoogleStatus('Not connected', true);
        return;
    }

    isSaving = true;
    exportSheetsButton.disabled = true;
    setSheetStatus('Saving VPC data...');

    // Open a blank tab during the click; redirect it after the save.
    pendingSheetWindow = window.open('about:blank', '_blank');

    try {
        await saveToGoogleSheets();
    } catch (error) {
        console.error('Google Sheets save error:', error);

        if (pendingSheetWindow && !pendingSheetWindow.closed) {
            pendingSheetWindow.close();
        }

        pendingSheetWindow = null;

        setSheetStatus(error.message, true);
        setStatus('Could not save: ' + error.message);
    } finally {
        isSaving = false;
        exportSheetsButton.disabled = false;
    }
});


/* ============================================================
   SECTION 19: CLEANUP
   Release the temporary image preview URL.
   ============================================================ */

window.addEventListener('beforeunload', () => {
    if (previewURL) {
        URL.revokeObjectURL(previewURL);
    }
});



/* ==========================================
   ROTATE DOCUMENT IMAGE
   - Rotates 90 degrees clockwise per click.
   - Updates the preview.
   - Updates currentFile so OCR uses the
     rotated image rather than the original.
   ========================================== */

async function rotateDocumentImage() {
    if (!originalFileForRotation) {
        setStatus('Please upload or capture a document first.');
        return;
    }

    rotateImageButton.disabled = true;

    try {
        const imageURL = URL.createObjectURL(
            originalFileForRotation
        );

        let image;

        try {
            image = new Image();

            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => {
                    reject(new Error('Could not load the document image.'));
                };
                image.src = imageURL;
            });
        } finally {
            // Revoke after the image has loaded.
            // The browser has already decoded the image.
        }

        rotationDegrees = (rotationDegrees + 90) % 360;

        const canvas = document.createElement('canvas');

        const sideways =
            rotationDegrees === 90 ||
            rotationDegrees === 270;

        canvas.width = sideways ? image.height : image.width;
        canvas.height = sideways ? image.width : image.height;

        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('Could not rotate the image.');
        }

        context.translate(
            canvas.width / 2,
            canvas.height / 2
        );

        context.rotate(rotationDegrees * Math.PI / 180);

        context.drawImage(
            image,
            -image.width / 2,
            -image.height / 2
        );

        URL.revokeObjectURL(imageURL);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(result => {
                if (result) {
                    resolve(result);
                } else {
                    reject(new Error('Could not create the rotated image.'));
                }
            }, 'image/png');
        });

        // OCR will now use this rotated image.
        currentFile = new File(
            [blob],
            'rotated-document.png',
            { type: 'image/png' }
        );

        // Replace the previous preview.
        if (previewURL) {
            URL.revokeObjectURL(previewURL);
        }

        previewURL = URL.createObjectURL(currentFile);

        if (documentPreview) {
            documentPreview.src = previewURL;
            documentPreview.hidden = false;
            documentPreview.style.display = 'block';
        }

        setStatus(
            'Image rotated ' + rotationDegrees +
            ' degrees. You can now extract the data.'
        );

    } catch (error) {
        console.error('Image rotation error:', error);
        setStatus('Could not rotate image: ' + error.message);

    } finally {
        rotateImageButton.disabled = !originalFileForRotation;
    }
}

rotateImageButton?.addEventListener(
    'click',
    rotateDocumentImage
);
