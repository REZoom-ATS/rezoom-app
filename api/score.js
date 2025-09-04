// This code runs on Vercel's server. It automates file parsing and AI scoring.

const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const busboy = require('busboy');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const fetch = require('node-fetch');

// Initialize Google Sheets API with your credentials.
// The private key is now expected in base64 format in the environment variable.
const privateKey = Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
const auth = new GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: privateKey,
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
        const prompt = `You are an expert ATS (Applicant Tracking System). Analyze the resume below and extract the candidate's personal data. Then, score the resume from 0-100 on ATS-friendliness for three categories and provide a brief comment for each.

**Scoring Criteria:**
1.  **Formatting & Layout:** Score on simplicity, common fonts, consistent date formats, and no images.
2.  **Content Strategy:** Score on strong action verbs, quantifiable metrics, and evidence of impact.
3.  **Contact Information:** Score on correct order (Name, headline, contact) and conciseness.

**Resume Content:**
---
${resumeText}
---

**Instructions:**
-   Respond with ONLY a JSON object.
-   The JSON must have the following keys:
    -   "personalData": {"name": "string", "email": "string", "phone": "string"}
    -   "scores": {"formatting": 0, "content": 0, "contact": 0}
    -   "comments": {"formatting": "string", "content": "string", "contact": "string"}
-   Do not include any other text or explanation outside of the JSON object.`;

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
