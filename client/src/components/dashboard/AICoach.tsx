import React, { useState } from 'react';
import { Bot, ArrowUp, Clock, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

export function AICoach() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: "Hey! Based on your current progress, I recommend focusing on improving your listening skills with Canadian accents. Would you like me to create a custom practice session for you?",
      sender: 'ai',
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content: inputValue,
      sender: 'user',
      timestamp: new Date(),
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');

    // Simulate an AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: `ai-${Date.now()}`,
        content: "Great! I've created a 20-minute listening practice focused on academic contexts with Canadian accents. This will help you with the specific challenges you've been facing in section 3 of the listening test.",
        sender: 'ai',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 1000);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Quick reply buttons to show below AI message
  const quickReplies = [
    "Yes, create a practice session",
    "What areas should I focus on?",
    "Show me my weak points"
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-lg flex flex-col h-[400px]">
      <div className="p-3 border-b flex items-center bg-gray-50">
        <div className="h-7 w-7 rounded-full bg-black flex items-center justify-center mr-2">
          <Bot className="h-4 w-4 text-white" />
        </div>
        <div>
          <h2 className="font-medium text-gray-900">AI Coach</h2>
        </div>
      </div>

      <div className="flex-grow overflow-y-auto p-3 space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-lg p-3 ${
                message.sender === 'user'
                  ? 'bg-gray-900 text-white rounded-br-none'
                  : 'bg-gray-100 text-gray-800 rounded-bl-none'
              }`}
            >
              <p className="text-sm">{message.content}</p>
              <div className="flex items-center justify-between mt-1">
                <div className={`text-xs ${message.sender === 'user' ? 'text-gray-300' : 'text-gray-500'}`}>
                  <Clock className="inline h-3 w-3 mr-1" />
                  {formatTime(message.timestamp)}
                </div>
                
                {message.sender === 'ai' && (
                  <div className="flex space-x-1">
                    <button className="text-gray-400 hover:text-gray-600">
                      <ThumbsUp className="h-3 w-3" />
                    </button>
                    <button className="text-gray-400 hover:text-gray-600">
                      <ThumbsDown className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {/* Quick replies */}
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {quickReplies.map((reply, index) => (
              <Button 
                key={index}
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setInputValue(reply);
                  setTimeout(() => handleSendMessage(), 100);
                }}
              >
                {reply}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t">
        <div className="flex rounded-md border border-gray-200 overflow-hidden bg-gray-50">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask your AI coach..."
            className="flex-grow px-3 py-2 focus:outline-none text-sm bg-transparent"
          />
          <Button
            onClick={handleSendMessage}
            size="sm"
            className="rounded-l-none"
            disabled={!inputValue.trim()}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}