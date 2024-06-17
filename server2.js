// import the required dependencies
require("dotenv").config();
const OpenAI = require("openai");
const fsPromises = require("fs").promises;
const fs = require("fs");
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});
const getCountryInformation = require("./countryInformation");
global.getCountryInformation = getCountryInformation;
// Create a OpenAI connection
const secretKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: secretKey,
});

async function askQuestion(question) {
  return new Promise((resolve, reject) => {
    readline.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  try {
    let assistantId;
    const assistantFilePath = "./assistant.json";

    // Check if the assistant.json file exists
    try {
      const assistantData = await fsPromises.readFile(
        assistantFilePath,
        "utf8"
      );
      assistantDetails = JSON.parse(assistantData);
      assistantId = assistantDetails.assistantId;
      console.log("\nExisting assistant detected.\n");
    } catch (error) {
      // If file does not exist or there is an error in reading it, create a new assistant
      console.log("No existing assistant detected, creating new.\n");
      const assistantConfig={
        name: "Financial Analyst Assistant",
        instructions: "You are an expert financial analyst. Use you knowledge base to answer questions about audited financial statements.",
        model: "gpt-4o",
        tools: [{ type: "file_search" }],
      }
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

    // Log the first greeting
    console.log(
      `Hello there, I'm your personal assistant. You gave me these instructions:\n${assistantDetails.instructions}\n`
    );

    //create a vector store
    const fileStreams = ["./data.txt","./data1.txt"].map((path) =>
        fs.createReadStream(path),
      );
       
      // Create a vector store including our two files.
      let vectorStore = await openai.beta.vectorStores.create({
        name: "Financial Statement",
      });
       
      await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, fileStreams)
      await openai.beta.assistants.update(assistantId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      });




      // A user wants to attach a file to a specific message, let's upload it.
// const aapl10k = await openai.files.create({
//     file: fs.createReadStream("./data3.txt"),
//     purpose: "assistants",
//   });
  







    // Create a thread using the assistantId
    const thread = await openai.beta.threads.create();

    // Use keepAsking as state for keep asking questions
    let keepAsking = true;
    while (keepAsking) {
      const action = await askQuestion(
        "What do you want to do?\n1. Chat with assistant\n2. Upload file to assistant\nEnter your choice (1 or 2): "
      );

      if (action === "2") {
        const fileName = await askQuestion("Enter the filename to upload: ");

        // Upload the file
        const file = await openai.files.create({
          file: fs.createReadStream('./data3.txt'),
          purpose: "assistants",
        });

        // Retrieve existing file IDs from assistant.json to not overwrite
        let existingFileIds = assistantDetails.file_ids || [];

        // Update the assistant with the new file ID
        await openai.beta.assistants.update(assistantId, {
          file_ids: [...existingFileIds, file.id],
        });

        // Update local assistantDetails and save to assistant.json
        assistantDetails.file_ids = [...existingFileIds, file.id];
        await fsPromises.writeFile(
          assistantFilePath,
          JSON.stringify(assistantDetails, null, 2)
        );

        console.log("File uploaded and successfully added to assistant\n");
      }

      if (action === "1") {
        let continueAskingQuestion = true;

        while (continueAskingQuestion) {
          const userQuestion = await askQuestion("\nWhat is your question? ");

          // Pass in the user question into the existing thread
          await openai.beta.threads.messages.create(thread.id,{
            messages: [
              {
                role: "user",
                content:
                  "How many shares of AAPL were outstanding at the end of of October 2023?",
                // Attach the new file to the message.
                attachments: [{ file_id: file.id, tools: [{ type: "file_search" }] }],
              },
            ],
          });

          // Create a run
          const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: assistantId,
          });

          // Imediately fetch run-status, which will be "in_progress"
          let runStatus = await openai.beta.threads.runs.retrieve(
            thread.id,
            run.id
          );

          // Polling mechanism to see if runStatus is completed
          while (runStatus.status !== "completed") {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            runStatus = await openai.beta.threads.runs.retrieve(
              thread.id,
              run.id
            );

            if (runStatus.status === "requires_action") {
            //   console.log(
            //     runStatus.required_action.submit_tool_outputs.tool_calls
            //   );
              const toolCalls =
                runStatus.required_action.submit_tool_outputs.tool_calls;
              const toolOutputs = [];

              for (const toolCall of toolCalls) {
                const functionName = toolCall.function.name;

                console.log(
                  `This question requires us to call a function: ${functionName}`
                );

                const args = JSON.parse(toolCall.function.arguments);

                const argsArray = Object.keys(args).map((key) => args[key]);

                // Dynamically call the function with arguments
                const output = await global[functionName].apply(null, [args]);

                toolOutputs.push({
                  tool_call_id: toolCall.id,
                  output: output,
                });
              }
              // Submit tool outputs
              await openai.beta.threads.runs.submitToolOutputs(
                thread.id,
                run.id,
                { tool_outputs: toolOutputs }
              );
              continue; // Continue polling for the final response
            }

            // Check for failed, cancelled, or expired status
            if (["failed", "cancelled", "expired"].includes(runStatus.status)) {
              console.log(
                `Run status is '${runStatus.status}'. Unable to complete the request.`
              );
              break; // Exit the loop if the status indicates a failure or cancellation
            }
          }

          // Get the last assistant message from the messages array
          const messages = await openai.beta.threads.messages.list(thread.id);

          // Find the last message for the current run
          const lastMessageForRun = messages.data
            .filter(
              (message) =>
                message.run_id === run.id && message.role === "assistant"
            )
            .pop();

          // If an assistant message is found, console.log() it
          if (lastMessageForRun) {
            console.log(`${lastMessageForRun.content[0].text.value} \n`);
          } else if (
            !["failed", "cancelled", "expired"].includes(runStatus.status)
          ) {
            console.log("No response received from the assistant.");
          }

          // Ask if the user wants to ask another question
          const continueAsking = await askQuestion(
            "Do you want to ask another question? (yes/no) "
          );
          continueAskingQuestion =
            continueAsking.toLowerCase() === "yes" ||
            continueAsking.toLowerCase() === "y";
        }
      }

      // Outside of action "1", ask if the user wants to continue with any action
      const continueOverall = await askQuestion(
        "Do you want to perform another action? (yes/no) "
      );
      keepAsking =
        continueOverall.toLowerCase() === "yes" ||
        continueOverall.toLowerCase() === "y";

      // If the keepAsking state is falsy show an ending message
      if (!keepAsking) {
        console.log("Alrighty then, see you next time!\n");
      }
    }
    // close the readline
    readline.close();
  } catch (error) {
    console.error(error);
  }
}

// Call the main function
main();




// const express = require('express');
// const axios = require('axios');
// const cors = require('cors');
// const multer = require('multer');
// const fs = require('fs');
// const path = require('path');
// const pdf = require('pdf-parse');
// const xlsx = require('xlsx');
// const mammoth = require('mammoth');
// const FormData = require('form-data');
// const config= require('dotenv').config();
// const OpenAI = require("openai");
// const fsPromises = require("fs").promises;  
// const readline = require("readline").createInterface({
//     input: process.stdin,
//     output: process.stdout,
//   });

// const app = express();
// const PORT =process.env.PORT
// app.use(cors());
// app.use(express.json());
// console.log(PORT); 
// const OPENAI_API_KEY=process.env.OPENAI_API_KEY
// console.log(OPENAI_API_KEY);
// const secretKey = process.env.OPENAI_API_KEY;
// const openai = new OpenAI({
//     apiKey: secretKey,
//   });



// const upload = multer({ dest: 'uploads/' });

// // Store message history
// let messageHistory = []; 

// // Function to encode image to base64
// const encodeImageToBase64 = (filePath) => {
//   const image = fs.readFileSync(filePath);
//   return image.toString('base64');
// };

// // Function to analyze image using OpenAI API
// const analyzeImage = async (filePath) => {
//   try { 
//     const base64Image = encodeImageToBase64(filePath); 
//     const base64ImageString = `data:image/jpeg;base64,${base64Image}`;

//     const response = await axios.post('https://api.openai.com/v1/chat/completions', {
//       model: 'gpt-4o',
//       messages: [
//         {
//           role: 'user',
//           content: [
//             { type: 'text', text: 'What’s in this image?' },
//             { type: 'image_url', image_url: { url: base64ImageString } }
//           ]
//         }
//       ],
//       max_tokens: 300
//     }, {
//       headers: {
//         'Authorization': `Bearer ${OPENAI_API_KEY}`,
//         'Content-Type': 'application/json'
//       }
//     });

//     const analysis = response.data.choices[0].message.content.trim();
//     return analysis;
//   } catch (error) {
//     console.error('Error:', error.response ? error.response.data : error.message);
//     throw new Error('Something went wrong with the AI request.');
//   }
// };

// // Endpoint to handle text-based chat requests
// app.post('/api/chat', upload.single('file'), async (req, res) => {
//   const userMessage = req.body.message;
//   const file = req.file;

//   let fileContent = '';
//   if (file) {
//     const filePath = path.join(__dirname, file.path);
//     const fileExtension = path.extname(file.originalname).toLowerCase();

//     try {
//       switch (fileExtension) {
//         case '.pdf':
//           const pdfDataBuffer = fs.readFileSync(filePath);
//           const pdfData = await pdf(pdfDataBuffer);
//           fileContent = pdfData.text;
//           break;
//         case '.xlsx':
//         case '.xls':
//           const workbook = xlsx.readFile(filePath);
//           const sheetName = workbook.SheetNames[0];
//           const worksheet = workbook.Sheets[sheetName];
//           fileContent = xlsx.utils.sheet_to_csv(worksheet);
//           break;
//         case '.docx':
//         case '.doc':
//           const docData = await mammoth.extractRawText({ path: filePath });
//           fileContent = docData.value;
//           break;
//         case '.jpg':
//         case '.jpeg':
//         case '.png':
//         case '.gif':
//           const imageAnalysisResult = await analyzeImage(filePath);
//           fileContent = `Image analysis result: ${JSON.stringify(imageAnalysisResult)}`;
//           break;
//         default:
//           fileContent = fs.readFileSync(filePath, 'utf-8');
//       }
//     } catch (err) {
//       console.error('Error processing file:', err);
//       res.status(500).json({ error: 'Error processing file' });
//       return;
//     }
//   }

//   // Add new message to history and keep only the last 25 messages
//   messageHistory.push({ role: 'user', content: `User message: ${userMessage}\nFile content: ${fileContent}` });
//   if (messageHistory.length > 25) {
//     messageHistory.shift(); // Remove the oldest message if history exceeds 25
//   }

//   try {
//     const response = await axios.post('https://api.openai.com/v1/chat/completions', {
//       model: 'gpt-4o',
//       messages: [
//         { role: 'system', content: 'You are a helpful assistant that provides detailed financial advice.' },
//         ...messageHistory // Include the message history in the request
//       ]
//     }, {
//       headers: {
//         'Authorization': `Bearer ${OPENAI_API_KEY}`,
//         'Content-Type': 'application/json'
//       }
//     });

//     const botMessage = response.data.choices[0].message.content.trim();
//     // Add assistant's response to history
//     messageHistory.push({ role: 'assistant', content: botMessage });
//     if (messageHistory.length > 25) {
//       messageHistory.shift(); // Remove the oldest message if history exceeds 25
//     }
    
//     res.json({ message: botMessage });
//   } catch (error) {
//     console.error('Error:', error.response ? error.response.data : error.message);
//     res.status(500).json({ error: 'Something went wrong with the AI request.' });
//   } finally {
//     if (file) {
//       fs.unlinkSync(path.join(__dirname, file.path)); // Clean up the uploaded file
//     }
//   }
// });

// // Endpoint to handle image uploads and analysis
// app.post('/api/upload', upload.single('image'), async (req, res) => {
//   const filePath = req.file.path;

//   try {
//     const base64Image = encodeImageToBase64(filePath);
//     const base64ImageString = `data:image/jpeg;base64,${base64Image}`;

//     // Clean up the uploaded file
//     fs.unlinkSync(filePath);

//     const response = await axios.post('https://api.openai.com/v1/chat/completions', {
//       model: 'gpt-4o',
//       messages: [
//         {
//           role: 'user',
//           content: [
//             { type: 'text', text: 'What’s in this image?' },
//             { type: 'image_url', image_url: { url: base64ImageString } }
//           ]
//         }
//       ],
//       max_tokens: 300
//     }, {
//       headers: {
//         'Authorization': `Bearer ${OPENAI_API_KEY}`,
//         'Content-Type': 'application/json'
//       }
//     });

//     const analysis = response.data.choices[0].message.content.trim();
//     res.json({ analysis: analysis });
//   } catch (error) {
//     console.error('Error:', error.response ? error.response.data : error.message);
//     res.status(500).json({ error: 'Something went wrong with the AI request.' });
//   }
// });

// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
// });
