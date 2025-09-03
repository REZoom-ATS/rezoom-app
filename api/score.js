// This code runs on Vercel's server. It automates file parsing and AI scoring.

const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const busboy = require('busboy');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const fetch = require('node-fetch');

// Initialize Google Sheets API with your credentials.
const auth = new GoogleAuth({
    credentials: {
        client_email: "rezoom-service-account@rezoom-470615.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDBlgnuOcJNC/3x\n003k9zHC33jbVraCg4YkfXJlKowRJIEKZoaVJ/eZXpnsR+H+L/gI79GZbOHhDhtU\nKpS42NYkVBEZoDVDh5Sxssf6s7OfCK4w9YZHC6Tms3X4ai96ww44WG49kguTvk8c\n+F/7BLzVVF2zQrJufvWZc7WcVqmB2fGKvdZQT1LpmxJ+THFqAR0wUiKnexUuffZK\nplIZfvhMQPOWtge2907h4NPb6qaqbaLhxS3+w62jG2wMS42+B77F2vhnKZ8vUCvA\nni1YW7shB3TLfOhlJ95/0okDo7+xn4U+rk3OA2xC06ghE8Fdb0yRxIUIC4ekOnZ+\nRT3NEzXXAgMBAAECgYANOAS6U88a4f9fkpdac8898HLRHm8UwyynI/pKYnEBUCn\nwFv9oYrvnaQRvdBqgV+/y00ZvmLXlX2haE1THuQXJYgSvaGdOsszCZBQAAGKa8NW\ntMezO/+JtHvLGqWCP3E8lpZM0iNsZxfhiwOqT6ldHJW1HCv5CaZC1f2dWszu8qjG\n96PJXuuOzUBcXdiFYNfOTvgMFkK9FBxE8mautPH01ivyhWIkbOua42T67GvPSXaU\n1Raut7dRXYlUAkzS5VWs66fr6r/pc55fNGlaXtX2P7BiBcvfazfJ2BeJdzbHizwQ\nZQBMkZs4Ac4RNj5EP1QKbOjauyfw4TpO6ZB/48CjJQKBgQD3+AfdV3dbhfBb5oqm\nUpz7ZeUq8E5MqulGjD4CCH6dox9L03cB8L8oLaSLElw6oS6NnWoSZ52mbvTmJCbF\n/uDdXGXijex2HYe+gapR6dkFoTd9aI5yFKbXgb3jsly6y0CC6QYXjVTiAoUqBNov\njga/M91WhGQa3DKAzQA4xnxjuwKBgQDH2xt/RbpyAt3IC2foFtLX2WTde4qF9T/h\nDVlCVdpAYyw2zKAfschKEjQzFihky7eRLZEMPUzehpvfHchyy3qCvz7uuZmLNidR\neAG2B/kLLuao0eAJR73UC8EeS6khHbkBVSOz041CZONiCiB+DwuC+ka/eqCfyNJ2\nvBUnZwPelQKBgQD0XPEjJzbwcqXTavXnwjIBbQDRt87xrtwEMeBJkKV2I3KL/vCg\ncOdwaMpmYsmQ3ZZK6H3HdWTexymAQtAS/oIKoyukf8gu/hrvmkiGQLUl3yIX7Bm0\nQrXIWosPAI5xZitE1u6x9w1XTLR+HBoIEyaC9lGBGSatcaIzW9KEINYkUQKBgCSm\n70UJEadlFS1hwh2TSfmh+diQlpf4oU1xuEPtIMicJ3ipUFhfr16+NeqEjsXlgnXS\niH5ZI6bPwvhJKwC6hm5CCpWXXixksxNC0fWDQs4lPNILI24wRQUFXtZig9L583rm\nFVUeYBKkE/tf5hOYSMEtixoEsD59gvOZjLucLd59AoGAQqWk4q1Pje2airSoLRQb\ni0Wo7ZJY9IR5JCewhc7SwkMKUqtNkU6TzpcmyiW/PlcydUXwybBngh7ILixWqg+a\nOrY000Mgz9lLI+JGE3WLXpONzBNAZB3OUMUJ4wzzBqJe30Zu2bDeQMtpk39kvlkO\nNOMVMxhUyQZiSqcG4tW5pVM=\n-----END PRIVATE KEY-----\n",
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const apiKey = process.env.GEMINI_API_KEY;

// Main handler for the Vercel serverless function
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const formData = await parseFormData(req);
        const file = formData.file;

        let resumeText;
        if (file.mimetype === 'application/pdf') {
            const data = await pdf(file.buffer);
            resumeText = data.text;
        } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            resumeText = result.value;
        } else {
            return res.status(400).json({ success: false, message: 'Unsupported file type.' });
        }
        
        // This is the prompt for the AI. It extracts data and scores the resume.
        const prompt = `You are an expert ATS (Applicant Tracking System). Your task is to analyze the following resume content.

**Action 1: Extract Personal Data**
Extract the candidate's full name, email address, and a contact phone number from the resume.

**Action 2: Score ATS-Friendliness**
Score the resume from 0 to 100 on ATS-friendliness for three categories based on these rules:
1.  **Formatting & Layout:** Score based on a simple layout, common fonts, consistent date formats, and the absence of images or complex graphics.
2.  **Content Strategy:** Score based on the use of strong action verbs, the inclusion of quantifiable data, and a clear narrative that shows impact.
3.  **Contact Information:** Score based on the correct order of information (Name, followed by a professional headline, then contact details).

**Resume Content:**
---
${resumeText}
---

**Instructions:**
-   Respond with only a single JSON object.
-   The JSON object must contain three main keys: "personalData", "scores", and "comments".
-   "personalData" should be an object with keys "name", "email", and "phone". Extract a valid phone number if present.
-   "scores" should be an object with integer values (0-100) for "formatting", "content", and "contact".
-   "comments" should be an object with a brief, one-sentence string for "formatting", "content", and "contact".`;

        const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=' + apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const geminiResult = await geminiResponse.json();
        const aiResponseText = geminiResult.candidates[0].content.parts[0].text;
        
        const atsResult = JSON.parse(aiResponseText);
        
        const overallScore = Math.round((atsResult.scores.formatting * 0.3) + (atsResult.scores.content * 0.5) + (atsResult.scores.contact * 0.2));

        // Add the extracted personal data and scores to your Google Sheet.
        await addDataToGoogleSheet({
            ...atsResult.personalData,
            atsScore: overallScore,
            fileName: file.originalFilename,
        });

        // The response sent back to the website
        res.status(200).json({
            success: true,
            score: overallScore,
            scores: atsResult.scores,
            comments: atsResult.comments,
            personalData: atsResult.personalData,
            message: "Resume successfully analyzed and submitted."
        });

    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ success: false, message: 'An error occurred during processing.' });
    }
};

// Function to parse the multipart form data from the request.
function parseFormData(req) {
    return new Promise((resolve, reject) => {
        const busboyInstance = busboy({ headers: req.headers });
        const result = { file: null };
        
        busboyInstance.on('file', (fieldname, file, info) => {
            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', () => {
                result.file = {
                    originalFilename: info.filename,
                    mimetype: info.mimeType,
                    buffer: Buffer.concat(chunks)
                };
            });
        });
        
        busboyInstance.on('finish', () => resolve(result));
        busboyInstance.on('error', (err) => reject(err));
        
        req.pipe(busboyInstance);
    });
}

// Function to write data to Google Sheets.
async function addDataToGoogleSheet(data) {
    const spreadsheetId = '1um9U-x-Tfq2n49sB4XyXlu-BuJ5t-2HFc7xmXtcK7y4';
    const range = 'Sheet1!A:G';
    const values = [[data.name, data.email, data.phone, data.atsScore, data.fileName]];
    const resource = { values };
    await sheets.spreadsheets.values.append({ spreadsheetId, range, valueInputOption: 'RAW', resource });
}
