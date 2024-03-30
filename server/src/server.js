
import express from 'express';
import {OpenAI}  from'openai';
//require('dotenv').config();

const app = express();
app.use(express.json());

const openai = new OpenAI({
  baseURL: 'https://donator.sweethoney.buzz/proxy/azure/openai/',
  apiKey: 'd05acc80-0dd0-4a5a-b62c-921eb73ebe95',
  //baseURL: 'https://chocolate-xl-charleston-repeat.trycloudflare.com/proxy/azure/openai',
  //apiKey: 'desu',
});



app.post('/chatbot', async (req, res) => {
  // Retrieve the chat history from the request body

  try {
    const messages = req.body.messages;

    // Convert chat history to the format expected by the OpenAI API
    const stream = await openai.chat.completions.create({
      //model: "gpt-4-1106-preview",
      model: "gpt-4-1106-preview",
      messages: messages,
      max_tokens: 4096,
      stream: true,
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