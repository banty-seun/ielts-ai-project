import React from 'react';
import { SkillCard } from './SkillCard';
import { Headphones } from 'lucide-react';
import { Progress } from '../../components/ui/progress';
import { Button } from '../../components/ui/button';

interface ListeningCardProps {
  band: number;
}

export function ListeningCard({ band }: ListeningCardProps) {
  // This would come from API in a real implementation
  const mockData = {
    progress: 65, // percentage
    weakness: 'Matching Qs (British Accent)',
    nextTask: 'Practice 5 Matching Qs',
    accuracy: [75, 65, 80] // last 3 attempts in percentage
  };

  return (
    <SkillCard
      title="Listening"
      icon={<Headphones size={20} />}
      band={band}
      color="blue"
    >
      <div className="space-y-4">
        {/* Progress Ring */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Progress</span>
          <span className="text-sm font-medium">{mockData.progress}%</span>
        </div>
        <Progress value={mockData.progress} className="h-2" />

        {/* Weakness */}
        <div>
          <p className="text-sm text-gray-500">Flagged Weakness:</p>
          <p className="text-sm font-medium mt-1">{mockData.weakness}</p>
        </div>

        {/* Next Task */}
        <div className="bg-blue-100 rounded-md p-3 my-3">
          <p className="text-sm font-medium text-blue-700">Next Recommended Task:</p>
          <p className="text-sm mt-1">{mockData.nextTask}</p>
        </div>

        {/* Mini Graph */}
        <div>
          <p className="text-sm text-gray-500 mb-2">Last 3 attempts:</p>
          <div className="flex space-x-1">
            {mockData.accuracy.map((score, index) => (
              <div key={index} className="flex-1">
                <div 
                  className="bg-blue-200 rounded-t-sm" 
                  style={{ height: `${score * 0.4}px` }}
                ></div>
                <div className="text-xs text-center mt-1">{score}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <Button variant="outline" className="w-full mt-4">
          Switch to Map Questions
        </Button>
      </div>
    </SkillCard>
  );
}