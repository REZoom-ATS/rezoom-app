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
        private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCmSFncJXOSFn6A\ngiIdFdAIiRo6ioihob3t8RGElPmGnAJaw+n7FVYxjAP3KMeyVMZpJxkwYkNWL14Q\ntvGlRCmfljRRnTej3A+R52gBnyjQyn209gyEqBs46T9jathYv8qRPBTLUCHdSbIF\nJw1voMZVNyWNYnqHmrGGtL9Kl4sB3aQoo57ZEEYbdWtzxWYzsNWz/IRqV1CaFBWv\nLyBnmo0eIrVTJSGR6xirfJvgPyniPdU4A6uy/cyFMOxSbfxW6sVajxcAezBiddbN\n2VNsJC5/t9wqzbqiaxXASNWmxxEOIZg9eZKhNOhJyFRpDjR9wmZ3mFRTmRBUQ/mB\nCspUy1iJAgMBAAECggEABPs0JWZbrrARJ0ctpgoSpFZIs/9Q89g0FtWN/R+mbn/S\nmoBGw+y6ksHNfWiTzQgFxqiCDe7vYVZOl0fcQGOCryqWjXIDhdLrF2vH1guIwBS8\njukq+V4axmWcP4P8FKWavFpnaREh71+5VIOmx5b2qPyXVXbhTXfZE95ze8OySXws\nWTw7y9Ba0wZh+8i+kmXtAYbsY7RyD0U+dHrKFPHYRl+AsGEqtIxmmxEeMiwSl9Ki\nrEu1YwW4ydPKQ3CwvQpX8Tr18FlxR5TDVT6Z2Av8zjArNQqJVdiy0JKlGfX3SYz+\nuxq5Ms3SkGvyekN4fi1cEXk8p94GjE6F67FqjRxBjQKBgQDftuj0Gz4vy44AjW9S\nF2bo4KPnKbO71lWUSi3CCSSHUdMQhZfUPBbXx2jGqc0GXRq+A5U/Xh1iwKFDBcCt\nr5oAxkt4JQ7+hlWjP5rgE6mm+zlRPo+eaj8OpGBJQRP7DR5dyhOil+0uFMtQfSlr\n5bCEeiwGx2iLtl6sU8kpPKGJZwKBgQC+R6GeS63pHrEnoQTdmq5NdW10HRJGDUPC\n6jg+bBEB6y7PmLVq+xGxXpSV1nLohFegltRqf2WzkbxtVwlO2FwAYbWq/t3Muy62\nZs/8YDGj9tYtZvyB3DIYn/J7yMGSJplc8vGELtt11LCx/RPp+kJSqgjqm5U5cJ0B\nx8PjVfyojwKBgQCj43CXW9nb08hsuTBjOEeotOD9+Pv10JgTMaCB9IaxJ41zHhtT\nM3zN9+XIk/TqKNtrlxI9t6aOLoqym0UEH/Gr34cPzHT3n+gP3lrTJxNet/LmARI\nrlcRl/P91lIX6c1kMiTeSWR1DMDBb1/H7pW5B3N3Z+A78dc7cYn9zrAcYwKBgFDk\n9yrrFbakG8CzTfRAjJXVtIDG0zwA66v0E5FGNDzSlYYgcBBZSP5VLWo+T3/Ws8JM\nHWZhXwVmkesSM5zXktV+tNNLo1QkyAk30HiFFNWWXRvUSsmSqaGabmZ9xP2zd0Py\n7Qa7PQXtNGmXJF42zPeD3mKPXnObEsTs/rSpm861AoGBAL+/ZaS5YmGGWhPwP33V\nNEKPUbvwpZ956xGbmX6vUYcOXSns/wSR4iD7xzdkPK2GmNSNIx0Ma1bmDFd1L+Ao\nwuNEoEmr0pZ1yj2MP0tZEQGiaYHI76nFKLsgjLYMVjNm9OV/FLcBfQqyMBrrR+D/\niRcm+lJ0BAOA/55GYt3QN8PU\n-----END PRIVATE KEY-----\n",
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
3.  **Contact Information:** Score on correct order (Name, followed by a professional headline, then contact details).

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
        
        if (!geminiResponse.ok) {
            console.error('Gemini API Error:', await geminiResponse.text());
            throw new Error('Failed to connect to the Gemini API.');
        }

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
