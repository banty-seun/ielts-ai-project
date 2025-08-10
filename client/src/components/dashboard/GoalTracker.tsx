import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Clock, Target, TrendingUp, Edit } from 'lucide-react';

interface GoalTrackerProps {
  targetBand: number;
  daysToGo: number;
  currentBand: number;
  skillBands: {
    listening: number;
    reading: number;
    writing: number;
    speaking: number;
  };
}

export function GoalTracker({ 
  targetBand, 
  daysToGo, 
  currentBand, 
  skillBands 
}: GoalTrackerProps) {
  const getProgressPercentage = (current: number, target: number) => {
    // Calculate percentage based on how close the current score is to the target
    const min = 1; // Minimum IELTS score
    const progress = ((current - min) / (target - min)) * 100;
    // Cap at 100%
    return Math.min(Math.max(progress, 0), 100);
  };

  const overallProgress = getProgressPercentage(currentBand, targetBand);
  
  // Define colors for different skills
  const skillColors = {
    listening: { bg: 'bg-blue-100', text: 'text-blue-700', progress: 'bg-blue-500' },
    reading: { bg: 'bg-green-100', text: 'text-green-700', progress: 'bg-green-500' },
    writing: { bg: 'bg-yellow-100', text: 'text-yellow-700', progress: 'bg-yellow-500' },
    speaking: { bg: 'bg-red-100', text: 'text-red-700', progress: 'bg-red-500' },
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Your IELTS Progress</h2>
        <button className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900">
          <Edit className="w-4 h-4 mr-1" /> Update
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Target Score Card */}
        <div className="bg-gray-50 rounded-lg p-4 flex items-start">
          <div className="mr-3 mt-1 bg-gray-200 p-2 rounded-full">
            <Target className="h-5 w-5 text-gray-700" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Target Band</p>
            <p className="text-2xl font-bold">{targetBand.toFixed(1)}</p>
          </div>
        </div>

        {/* Test Countdown Card */}
        <div className="bg-gray-50 rounded-lg p-4 flex items-start">
          <div className="mr-3 mt-1 bg-gray-200 p-2 rounded-full">
            <Clock className="h-5 w-5 text-gray-700" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Test Date</p>
            <p className="text-2xl font-bold">{daysToGo} <span className="text-base font-normal text-gray-500">days left</span></p>
          </div>
        </div>

        {/* Current Band Card */}
        <div className="bg-gray-50 rounded-lg p-4 flex items-start">
          <div className="mr-3 mt-1 bg-gray-200 p-2 rounded-full">
            <TrendingUp className="h-5 w-5 text-gray-700" />
          </div>
          <div className="w-full">
            <p className="text-sm font-medium text-gray-500">Current Band</p>
            <p className="text-2xl font-bold">{currentBand.toFixed(1)}</p>
            <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
              <div 
                className="bg-black h-1.5 rounded-full" 
                style={{ width: `${overallProgress}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {/* Mini Skill Progress Bars */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(skillBands).map(([skill, band]) => {
          const colorSet = skillColors[skill as keyof typeof skillColors];
          return (
            <div key={skill} className={`${colorSet.bg} rounded-md p-3`}>
              <div className="flex justify-between items-center mb-1">
                <p className="text-sm font-medium capitalize">{skill}</p>
                <p className={`text-sm font-bold ${colorSet.text}`}>{band.toFixed(1)}</p>
              </div>
              <div className="w-full bg-white bg-opacity-50 rounded-full h-1.5">
                <div 
                  className={`${colorSet.progress} h-1.5 rounded-full`}
                  style={{ width: `${getProgressPercentage(band, targetBand)}%` }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}