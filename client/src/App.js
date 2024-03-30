//import logo from './logo.svg';
import './App.css';
//import './markdown.css';
import 'github-markdown-css';
import Cookies from 'js-cookie';
import React, { useState } from 'react';
import userAvatar from './user.svg'; // Add your user avatar image in src folder
import botAvatar from './openai.svg';  // Add your bot avatar image in src folder
import {marked} from 'marked';
import DOMPurify from 'dompurify';

function App() {
  const createMarkup = (markdownText) => {
    const rawMarkup = marked(markdownText, { breaks: true });
    console.log('rawMarkup:', rawMarkup);
    return { __html: DOMPurify.sanitize(rawMarkup) };
  };
  const [messages, setMessages] = useState([]);

  const [input, setInput] = useState('');

  //const [showSettings, setShowSettings] = useState(false);
  const defaultPrompt = '';
  const defaultTemperature = 1;
  const [prompt, setPrompt] = useState(Cookies.get('prompt') || defaultPrompt);
  const [temperature, setTemperature] = useState(Cookies.get('temperature') ||defaultTemperature);
  const [popupClass, setPopupClass] = useState('default');
  
  /*
  useEffect(() => {
    if (showSettings) {
      setPopupClass('fadeIn');
    } else if (!showSettings && popupClass) {
      setPopupClass('fadeOut');
      setTimeout(() => {
        setPopupClass('');
      }, 500);
      // Set a timeout to remove the popup after the animation
    }
  }, [showSettings, popupClass]); // Include popupClass in the dependency array
  */

  const toggleSettings = () => {
    if (popupClass==='default' || popupClass==='fadeOut') {
      // First, fade out the popup
      setPopupClass('fadeIn');
    } else {
      // Fade in the popup
      setPopupClass('fadeOut');
    }
  };
  const handlePromptChange = (e) => {
    setPrompt(e.target.value);
    Cookies.set('prompt', e.target.value);
  };


  const handleTemperatureChange = (e) => {
    setTemperature(e.target.value);
    Cookies.set('temperature', e.target.value);
  };

  const handleDeleteLastMessage = () => {
    setMessages(messages.slice(0, -1));
  };
  
  const handleRegenerateLastMessage = async () => {
    await handleSend('');
  };
  const handleRestoreDefaults = () => {
    setPrompt(defaultPrompt);
    setTemperature(defaultTemperature);
    Cookies.set('prompt', defaultPrompt);
    Cookies.set('temperature', defaultTemperature.toString());
  };
  const handleSend = async (messageContent) => {
    
    let updatedMessages = messages;
    if(messageContent!=='')
    {
      const newMessage = { content: messageContent, role: 'user' };
      updatedMessages = [...messages, newMessage];
      setMessages(updatedMessages);
    }
    //setMessages(updatedMessages);
    //setInput(''); // Clear input after sending
    try {
      const response = await fetch('/chatbot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: updatedMessages,
          prompt: prompt,
          temperature: parseFloat(temperature)
        }),
      });
      const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
      let data = "";
      const botResponse = { content: data, role: 'assistant' };
      setMessages(prevMessages => [...prevMessages, botResponse]);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        data+=value;
        const botResponse = { content: data, role: 'assistant' };
        setMessages(prevMessages => [...prevMessages.slice(0, prevMessages.length - 1), botResponse]);
        }
    } catch (error) {
      console.error('Failed to send message to backend:', error);
    }
  };
const handleSendClick = async () => {
  if (input.trim()) {
    await handleSend(input);
    setInput(''); // Clear input after sending
  }
};
  
  const handleInputChange = (e) => {
    setInput(e.target.value);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevent the default action to avoid adding a newline
      handleSendClick();
    }
  };

  return (
    <div className="App">
    <div className="ChatWindow">
      {messages.map((message, index) => (
        <div key={index} className={`message ${message.role}`}>
          {message.role === 'assistant' && (
            <img src={botAvatar} alt="Bot avatar" className="avatar" />
          )}
          <div className="text markdown-body"   dangerouslySetInnerHTML={createMarkup(message.content)}></div>
          {message.role === 'user' && (
            <img src={userAvatar} alt="User avatar" className="avatar" />
          )}
        </div>
      ))}
    </div>
    <div className="InputArea">
      <textarea
        type="text"
        value={input}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
      />
  <button onClick={handleSendClick} aria-label="Send message" className="emojiButton">✉️</button>
  <button onClick={handleDeleteLastMessage} aria-label="Delete last message" className="emojiButton">❌</button>
  <button onClick={handleRegenerateLastMessage} aria-label="Regenerate last message" className="emojiButton">🔄</button>
  <button onClick={toggleSettings}  aria-label="Settings"  className="emojiButton">⚙️</button>
  { (
  <div className={`settingsPopup ${popupClass}`}>
    <label>
      System Prompt:
      <textarea value={prompt} onChange={handlePromptChange} />
    </label>
    <label>
      Temperature:
      <input
        type="range"
        min="0"
        max="2"
        step="0.01"
        value={temperature}
        onChange={handleTemperatureChange}
      />
      <span>{temperature}</span>
    </label>
    <button className="emojiButton" onClick={handleRestoreDefaults}>Default</button>
    <button className="emojiButton" onClick={toggleSettings}>Close</button>
  </div>
  )}
    
    </div>
  </div>
  );
  
}

export default App;
