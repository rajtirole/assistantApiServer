require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const OpenAI = require("openai");
const fsPromises = require("fs").promises;

const app = express();
const PORT = process.env.PORT || 5000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

let userThreads = {}; // Store user threads by user ID

app.post("/chat", upload.single('file'), async (req, res) => {
  console.log("chat");
  const message = req.body.message;
  const userId = req.body.userId;
  let threadId = userThreads[userId];

  // Process the file if uploaded, otherwise use the text message
  let content = "";
  if (req.file) {
    const file = req.file;
    const fileBuffer = await fsPromises.readFile(file.path);

    if (file.mimetype === 'application/pdf') {
      const data = await pdf(fileBuffer);
      content = data.text;
    } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
      content = value;
    } else if (file.mimetype === 'text/plain') {
      content = fileBuffer.toString();
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }
  } else {
    content = message;
  }

  if (!threadId) {
    const assistantConfig = {
      name: "Assistant",
      instructions: "I'm your personal assistant. Feel free to ask me anything!",
      model: "gpt-4o",
    };
    const assistant = await openai.assistants.create(assistantConfig);
    threadId = assistant.id;
    userThreads[userId] = threadId;
  }

  try {
    const response = await openai.assistants.complete({
      model: "gpt-4o",
      messages: [
        { role: "user", content: content },
      ],
      assistantId: threadId,
    });

    res.status(200).json({ response: response });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log("Listening on port ", PORT);
});
