import React from 'react';
import { format } from 'date-fns';
import { Calendar } from 'lucide-react';

interface HeroGreetingProps {
  username: string;
  date: Date;
}

export function HeroGreeting({ username, date }: HeroGreetingProps) {
  const getGreeting = () => {
    const hour = date.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const formattedDate = format(date, 'EEEE, MMMM d');

  return (
    <div className="relative overflow-hidden rounded-lg mb-6 mt-6">
      <div 
        className="p-6 md:p-8 flex flex-col justify-center h-auto md:h-40"
        style={{
          background: 'linear-gradient(to right, #f8f9fa, #e9ecef)',
        }}
      >
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
              {getGreeting()}, {username}
            </h1>
            <p className="mt-1 text-gray-600 flex items-center">
              <Calendar className="inline h-4 w-4 mr-1" /> {formattedDate}
            </p>
          </div>
          
          <div className="mt-4 md:mt-0">
            <div className="inline-flex items-center px-4 py-2 bg-black text-white text-sm font-medium rounded-md shadow-sm">
              Start Practice Session
            </div>
          </div>
        </div>

        {/* Simple decorative element */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-green-500 to-yellow-500" />
      </div>
    </div>
  );
}