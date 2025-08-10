import React, { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface SkillCardProps {
  title: string;
  icon: ReactNode;
  band: number;
  color: 'blue' | 'green' | 'yellow' | 'red';
  children: ReactNode;
}

export function SkillCard({ 
  title, 
  icon, 
  band, 
  color, 
  children 
}: SkillCardProps) {
  // Define colors for each skill type
  const colors = {
    blue: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-700',
      bandBg: 'bg-blue-100',
    },
    green: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      text: 'text-green-700',
      bandBg: 'bg-green-100',
    },
    yellow: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      text: 'text-yellow-700',
      bandBg: 'bg-yellow-100',
    },
    red: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-700',
      bandBg: 'bg-red-100',
    },
  };

  const selectedColor = colors[color];

  return (
    <div className={cn(
      'rounded-lg border p-5 overflow-hidden h-full flex flex-col',
      selectedColor.bg,
      selectedColor.border,
    )}>
      {/* Card Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-center">
          <span className={cn('mr-2', selectedColor.text)}>{icon}</span>
          <h3 className="font-semibold text-gray-900">{title}</h3>
        </div>
        <div className={cn(
          'px-3 py-1 rounded-full font-medium text-sm',
          selectedColor.bandBg,
          selectedColor.text,
        )}>
          Band {band.toFixed(1)}
        </div>
      </div>

      {/* Card Content */}
      <div className="mt-4 flex-grow">
        {children}
      </div>
    </div>
  );
}