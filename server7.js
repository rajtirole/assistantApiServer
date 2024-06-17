require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const xlsx = require("xlsx");
const mammoth = require("mammoth");
const OpenAI = require("openai");
const fsPromises = require("fs").promises;
const connectDB = require("./db");
const auth = require("./authMiddleware");
const User = require("./User");
const cookiesParser = require("cookie-parser");
const app = express();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PORT = process.env.PORT;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});
const corsOptions = {
  origin: "http://localhost:3000", // The frontend URL
  credentials: true, // Allow credentials (cookies, authorization headers, etc.)
};
app.use(cookiesParser());
app.use(cors(corsOptions));
app.use(express.json());

connectDB();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// Authentication routes
app.post("/auth/register", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ msg: "User already exists" });
    }

    user = new User({
      username,
      email,
      password,
    });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    await user.save();

    const payload = {
      user: {
        id: user.id,
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
      (err, token) => {
        if (err) throw err;
        user.authToken = token;
        user.save();
        res.header("x-auth-token", token).json({ token });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Login user
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: "Invalid Credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid Credentials" });
    }

    const payload = {
      user: {
        id: user.id,
        threadId: user.threadId,
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
      (err, token) => {
        if (err) throw err;
        user.authToken = token;
        user.save();

        res
          .cookie("token", token, {
            sameSite: "strict",
          })
          .json({
            success: "true",
            token,
            id: user.id,
            threadId: user.threadId,
          });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.post("/chat/:id", [auth, upload.array("files")], async (req, res) => {
  const { message } = req.body;
  let assistantId;
  let thread = {};
  thread.id = req.params.id || req.user.threadId;
  const assistantFilePath = "./assistant.json";

  // Check if the assistant.json file exists
  try {
    const assistantData = await fsPromises.readFile(assistantFilePath, "utf8");
    assistantDetails = JSON.parse(assistantData);
    assistantId = assistantDetails.assistantId;
    console.log("\nExisting assistant detected.\n");
  } catch (error) {
    // If file does not exist or there is an error in reading it, create a new assistant
    console.log("No existing assistant detected, creating new.\n");
    const assistantConfig = {
      name: "Financial Analyst Assistant",
      instructions:
        "You are an expert financial analyst. Use your knowledge base to answer questions about financial statements and also the other queries of the user.",
      model: "gpt-4-turbo-preview",
      //   model: "gpt-4o",
      tools: [{ type: "file_search" }],
    };
    const assistant = await openai.beta.assistants.create(assistantConfig);
    console.log(assistant);
    assistantDetails = { assistantId: assistant.id, ...assistantConfig };

    // Save the assistant details to assistant.json
    await fsPromises.writeFile(
      assistantFilePath,
      JSON.stringify(assistantDetails, null, 2)
    );

    assistantId = assistantDetails.assistantId;
  }
  console.log(
    `Hello there, I'm your personal assistant. You gave me these instructions:\n${assistantDetails.instructions}\n`
  );

  const threadMessages = [
    {
      role: "user",
      content: `${message}`,
    },
  ];

  //   const fileStreams = ["./data1.txt", "./data3.txt"].map((path) =>
  //     fs.createReadStream(path),
  //   );

  // Create a vector store including our two files.

  //   let a=await openai.beta.vectorStores.fileBatches.update(vectorStore.id, fileStreams)
  //   let aa=await openai.beta.assistants.update(assistantId, {
  //     tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
  //   });

  if (req.files?.length > 0) {
    const attachments = [];
    for (const file of req.files) {
      let filePath = file.path;
      if (filePath.endsWith(".xlsx") || filePath.endsWith(".xls")) {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        jsonData = xlsx.utils.sheet_to_json(sheet);
        const jsonFilePath = filePath.replace(path.extname(filePath), ".json");
        fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 2));
        filePath = jsonFilePath;
        const createdFile = await openai.files.create({
          file: fs.createReadStream(filePath),
          purpose: "assistants",
        });
        attachments.push({
          file_id: createdFile.id,
          tools: [{ type: "file_search" }],
        });
      } else {
        const createdFile = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: "assistants",
        });
        attachments.push({
          file_id: createdFile.id,
          tools: [{ type: "file_search" }],
        });
        const vectorStore = await openai.beta.vectorStores.create({
          name: "Product Documentation",
          file_ids: [createdFile.id, createdFile.id],
        });
        await openai.beta.assistants.update(assistantId, {
          tool_resources: {
            file_search: { vector_store_ids: [vectorStore.id] },
          },
        });
      }

      //     //   let vectorStore = await openai.beta.vectorStores.create({
      //     //     name: "Financial Statement",
      //     //   });
      //     //   await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, fs.createReadStream(file.path))
      //     //   await openai.beta.assistants.update(assistantId, {
      //     //     tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      //     //   });

      // Remove the original and the converted file from the system
      fs.unlink(file.path, (err) => {
        if (err) {
          console.error(`Error deleting file: ${file.path} - ${err.message}`);
        } else {
          console.log(`File deleted: ${file.path}`);
        }
      });
    }

    threadMessages[0].attachments = attachments;
  }

  if (thread.id === "0") {
    let user = await User.findById(req.user.id);

    let threads = await openai.beta.threads.create({
      messages: threadMessages,
    });
    user.threadId = threads.id;
    thread.id = threads.id;
    await user.save();
  } else {
    const message = await openai.beta.threads.messages.create(
      thread.id,
      threadMessages[0]
    );
  }
  const run = openai.beta.threads.runs
    .stream(thread.id, {
      assistant_id: assistantId,
    })
    .on("textCreated", (text) => process.stdout.write("\nassistant > "))
    .on("textDelta", (textDelta, snapshot) =>
      process.stdout.write(textDelta.value)
    )
    .on("toolCallCreated", (toolCall) =>
      process.stdout.write(`\nassistant > ${toolCall.type}\n\n`)
    )
    .on("toolCallDelta", (toolCallDelta, snapshot) => {
      if (toolCallDelta.type === "code_interpreter") {
        if (toolCallDelta.code_interpreter.input) {
          process.stdout.write(toolCallDelta.code_interpreter.input);
        }
        if (toolCallDelta.code_interpreter.outputs) {
          process.stdout.write("\noutput >\n");
          toolCallDelta.code_interpreter.outputs.forEach((output) => {
            if (output.type === "logs") {
              process.stdout.write(`\n${output.logs}\n`);
            }
          });
        }
      }
    })
    .on("messageDone", async (event) => {
      if (event.content[0].type === "text") {
        const { text } = event.content[0];
        console.log(text);
        const { annotations } = text;
        const citations = [];

        let index = 0;
        for (let annotation of annotations) {
          text.value = text.value.replace(annotation.text, `[${index}]`);
          const { file_citation } = annotation;
          if (file_citation) {
            const citedFile = await openai.files.retrieve(
              file_citation.file_id
            );
            citations.push(`[${index}] ${citedFile.filename}`);
          }
          index++;
        }

        console.log(citations.join("\n"));
        return res.status(200).json({
          success: "true",
          message: text.value,
          value: citations,
          threadId: thread.id,
        });
      }
    });
});

app.listen(PORT, () => {
  console.log("listening on port ", PORT);
});
