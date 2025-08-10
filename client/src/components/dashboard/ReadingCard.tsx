import React from 'react';
import { SkillCard } from './SkillCard';
import { BookOpen } from 'lucide-react';
import { Button } from '../../components/ui/button';

interface ReadingCardProps {
  band: number;
}

export function ReadingCard({ band }: ReadingCardProps) {
  // This would come from API in a real implementation
  const mockData = {
    skillTarget: 'Improve time efficiency',
    highlightedArea: 'Skimming & Scanning Practice',
    taskType: 'True/False Practice (History Passage)'
  };

  return (
    <SkillCard
      title="Reading"
      icon={<BookOpen size={20} />}
      band={band}
      color="green"
    >
      <div className="space-y-4">
        {/* Skill Target */}
        <div className="bg-green-100 rounded-md p-3">
          <p className="text-sm font-medium text-green-700">Skill Target:</p>
          <p className="text-sm mt-1">{mockData.skillTarget}</p>
        </div>

        {/* Highlighted Practice Area */}
        <div>
          <p className="text-sm text-gray-500">Highlighted Area:</p>
          <p className="text-sm font-medium mt-1">{mockData.highlightedArea}</p>
          
          <div className="mt-4 bg-white border border-green-200 rounded-md p-3">
            <div className="flex items-center">
              <div className="h-2 w-2 rounded-full bg-green-500 mr-2"></div>
              <p className="text-sm font-medium">Recommended Practice</p>
            </div>
            <p className="text-sm mt-2">{mockData.taskType}</p>
          </div>
        </div>
        
        {/* Time Tracker */}
        <div className="mt-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-500">Average Time Per Question</span>
            <span className="text-sm font-medium">1m 45s</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div 
              className="bg-green-500 h-1.5 rounded-full" 
              style={{ width: '70%' }} 
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Goal: 1m 20s</span>
            <span>Current: 1m 45s</span>
          </div>
        </div>

        {/* Action Button */}
        <Button variant="outline" className="w-full mt-4">
          Start Reading Practice
        </Button>
      </div>
    </SkillCard>
  );
}