import React from 'react';
import { SkillCard } from './SkillCard';
import { PenTool } from 'lucide-react';
import { Button } from '../../components/ui/button';

interface WritingCardProps {
  band: number;
}

export function WritingCard({ band }: WritingCardProps) {
  // This would come from API in a real implementation
  const mockData = {
    lastTaskScore: 5.5,
    taskType: 'Task 2',
    feedback: 'Needs more cohesive devices',
    suggestedAction: 'Watch a sample answer + Rewrite Intro'
  };

  return (
    <SkillCard
      title="Writing"
      icon={<PenTool size={20} />}
      band={band}
      color="yellow"
    >
      <div className="space-y-4">
        {/* Last Task Score */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Last Task Scored:</span>
          <div className="flex items-center">
            <span className="text-sm">{mockData.taskType} –</span>
            <span className="ml-1 text-sm font-medium">{mockData.lastTaskScore}</span>
          </div>
        </div>
        
        {/* Score Breakdown */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-yellow-50 p-2 rounded">
            <p className="text-gray-500">Task Achievement</p>
            <p className="font-medium">6.0</p>
          </div>
          <div className="bg-yellow-50 p-2 rounded">
            <p className="text-gray-500">Coherence</p>
            <p className="font-medium">5.0</p>
          </div>
          <div className="bg-yellow-50 p-2 rounded">
            <p className="text-gray-500">Lexical Resource</p>
            <p className="font-medium">5.5</p>
          </div>
          <div className="bg-yellow-50 p-2 rounded">
            <p className="text-gray-500">Grammar</p>
            <p className="font-medium">5.5</p>
          </div>
        </div>

        {/* AI Feedback */}
        <div className="bg-yellow-100 rounded-md p-3">
          <p className="text-sm font-medium text-yellow-700">AI Feedback Highlight:</p>
          <p className="text-sm mt-1">"{mockData.feedback}"</p>
        </div>

        {/* Suggested Action */}
        <div>
          <p className="text-sm text-gray-500">Suggested Action:</p>
          <p className="text-sm font-medium mt-1">{mockData.suggestedAction}</p>
        </div>

        {/* Action Button */}
        <Button variant="outline" className="w-full mt-4">
          Write a new Task 1 or 2
        </Button>
      </div>
    </SkillCard>
  );
}