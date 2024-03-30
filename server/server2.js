
const express = require('express');
const OpenAI  = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());
const openai = new OpenAI({
  baseURL: 'https://deluxe-jumping-roads-platinum.trycloudflare.com/azure',
  apiKey: 'desu',
}
);




app.post('/chatbot', async (req, res) => {
  // Retrieve the chat history from the request body
  const chatHistory = req.body.chatHistory;

  // Convert chat history to the format expected by the OpenAI API
  const openaiMessages = chatHistory.map(message => ({
    role: message.author === 'user' ? 'user' : 'assistant',
    content: message.text
  }));

  try {
    const stream = await openai.chat.completions.create({
      //model: "gpt-4-1106-preview",
      model: "gpt-4",
      messages: openaiMessages,
      max_tokens: 4096,
      stream: true,
    });

    // Set headers for chunked transfer
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
    });

    // Iterate over the stream and send each chunk as it arrives
    for await (const chunk of stream) {
      process.stdout.write(chunk.choices[0]?.delta?.content || '');
      res.write(chunk.choices[0]?.delta?.content || '');
    }
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to process the request');
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});