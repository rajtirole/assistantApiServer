const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const xlsx = require('xlsx');
const mammoth = require('mammoth');
const FormData = require('form-data');
const config= require('dotenv').config();

const app = express();
const PORT =process.env.PORT
const OPENAI_API_KEY=process.env.OPENAI_API_KEY
app.use(cors());
app.use(express.json());
console.log(PORT); 
console.log(OPENAI_API_KEY);

const upload = multer({ dest: 'uploads/' });

// Store message history
let messageHistory = []; 

// Function to encode image to base64
const encodeImageToBase64 = (filePath) => {
  const image = fs.readFileSync(filePath);
  return image.toString('base64');
};

// Function to analyze image using OpenAI API
const analyzeImage = async (filePath) => {
  try { 
    const base64Image = encodeImageToBase64(filePath); 
    const base64ImageString = `data:image/jpeg;base64,${base64Image}`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What’s in this image?' },
            { type: 'image_url', image_url: { url: base64ImageString } }
          ]
        }
      ],
      max_tokens: 300
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const analysis = response.data.choices[0].message.content.trim();
    return analysis;
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
    throw new Error('Something went wrong with the AI request.');
  }
};

// Endpoint to handle text-based chat requests
app.post('/api/chat', upload.single('file'), async (req, res) => {
  const userMessage = req.body.message;
  const file = req.file;

  let fileContent = '';
  if (file) {
    const filePath = path.join(__dirname, file.path);
    const fileExtension = path.extname(file.originalname).toLowerCase();

    try {
      switch (fileExtension) {
        case '.pdf':
          const pdfDataBuffer = fs.readFileSync(filePath);
          const pdfData = await pdf(pdfDataBuffer);
          fileContent = pdfData.text;
          break;
        case '.xlsx':
        case '.xls':
          const workbook = xlsx.readFile(filePath);
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          fileContent = xlsx.utils.sheet_to_csv(worksheet);
          break;
        case '.docx':
        case '.doc':
          const docData = await mammoth.extractRawText({ path: filePath });
          fileContent = docData.value;
          break;
        case '.jpg':
        case '.jpeg':
        case '.png':
        case '.gif':
          const imageAnalysisResult = await analyzeImage(filePath);
          fileContent = `Image analysis result: ${JSON.stringify(imageAnalysisResult)}`;
          break;
        default:
          fileContent = fs.readFileSync(filePath, 'utf-8');
      }
    } catch (err) {
      console.error('Error processing file:', err);
      res.status(500).json({ error: 'Error processing file' });
      return;
    }
  }

  // Add new message to history and keep only the last 25 messages
  messageHistory.push({ role: 'user', content: `User message: ${userMessage}\nFile content: ${fileContent}` });
  if (messageHistory.length > 25) {
    messageHistory.shift(); // Remove the oldest message if history exceeds 25
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that provides detailed financial advice.' },
        ...messageHistory // Include the message history in the request
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const botMessage = response.data.choices[0].message.content.trim();
    // Add assistant's response to history
    messageHistory.push({ role: 'assistant', content: botMessage });
    if (messageHistory.length > 25) {
      messageHistory.shift(); // Remove the oldest message if history exceeds 25
    }
    
    res.json({ message: botMessage });
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Something went wrong with the AI request.' });
  } finally {
    if (file) {
      fs.unlinkSync(path.join(__dirname, file.path)); // Clean up the uploaded file
    }
  }
});

// Endpoint to handle image uploads and analysis
app.post('/api/upload', upload.single('image'), async (req, res) => {
  const filePath = req.file.path;

  try {
    const base64Image = encodeImageToBase64(filePath);
    const base64ImageString = `data:image/jpeg;base64,${base64Image}`;

    // Clean up the uploaded file
    fs.unlinkSync(filePath);

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What’s in this image?' },
            { type: 'image_url', image_url: { url: base64ImageString } }
          ]
        }
      ],
      max_tokens: 300
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const analysis = response.data.choices[0].message.content.trim();
    res.json({ analysis: analysis });
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Something went wrong with the AI request.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
