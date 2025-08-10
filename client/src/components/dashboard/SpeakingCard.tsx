import React from 'react';
import { SkillCard } from './SkillCard';
import { Mic, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';

interface SpeakingCardProps {
  band: number;
}

export function SpeakingCard({ band }: SpeakingCardProps) {
  // This would come from API in a real implementation
  const mockData = {
    lastFeedback: 'Improve fluency and reduce fillers',
    taskTopic: 'Work & Study',
    taskCount: 3
  };

  return (
    <SkillCard
      title="Speaking"
      icon={<Mic size={20} />}
      band={band}
      color="red"
    >
      <div className="space-y-4">
        {/* Last Feedback */}
        <div className="bg-red-100 rounded-md p-3">
          <p className="text-sm font-medium text-red-700">Last Feedback:</p>
          <p className="text-sm mt-1">"{mockData.lastFeedback}"</p>
        </div>

        {/* Task */}
        <div className="bg-white border border-red-200 rounded-md p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Practice {mockData.taskCount} Questions</p>
            <span className="text-xs text-gray-500">({mockData.taskTopic})</span>
          </div>
          
          <div className="mt-4 flex justify-center">
            <Button variant="outline" className="rounded-full h-16 w-16 flex items-center justify-center p-0 border-red-300">
              <Mic className="h-6 w-6 text-red-600" />
            </Button>
          </div>
          
          <p className="text-xs text-center mt-2 text-gray-500">
            Tap to record your response
          </p>
        </div>
        
        {/* Progress Tracker */}
        <div className="mt-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span>1/3 complete</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div 
              className="bg-red-500 h-1.5 rounded-full" 
              style={{ width: '33%' }} 
            ></div>
          </div>
        </div>

        {/* Action Button */}
        <Button variant="outline" className="w-full mt-4" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" /> Change Topic
        </Button>
      </div>
    </SkillCard>
  );
}