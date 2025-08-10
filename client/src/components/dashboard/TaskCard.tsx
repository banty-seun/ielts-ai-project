import React from 'react';
import { cn } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '../../components/ui/card';
import { ClockIcon, BookmarkIcon, MicIcon, BookOpenIcon } from 'lucide-react';

interface TaskCardProps {
  title: string;
  day: string;
  duration: string;
  status: string;
  skill: string;
  accent?: string;
  description?: string;
  contextType?: string;
  onClick?: () => void;
  className?: string;
}

export function TaskCard({
  title,
  day,
  duration,
  status,
  skill,
  accent,
  description,
  contextType,
  onClick,
  className
}: TaskCardProps) {
  // Get the appropriate skill icon
  const SkillIcon = () => {
    switch (skill.toLowerCase()) {
      case 'listening':
        return <MicIcon className="w-4 h-4 mr-1" />;
      case 'reading':
        return <BookOpenIcon className="w-4 h-4 mr-1" />;
      default:
        return <BookmarkIcon className="w-4 h-4 mr-1" />;
    }
  };

  // Get the status badge color
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'bg-green-100 text-green-800 hover:bg-green-100';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 hover:bg-blue-100';
      case 'not_started':
      default:
        return 'bg-gray-100 text-gray-800 hover:bg-gray-100';
    }
  };

  const statusText = status.toLowerCase().replace('_', ' ');

  return (
    <Card 
      className={cn(
        "w-full border border-gray-200 hover:border-gray-300 transition-all cursor-pointer", 
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex justify-between items-start">
          <Badge variant="outline" className="bg-gray-100 text-xs font-medium">
            {day}
          </Badge>
          <Badge 
            variant="outline" 
            className={cn("text-xs font-medium capitalize", getStatusColor(status))}
          >
            {statusText}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="px-4 py-2">
        <h3 className="font-medium text-sm mb-1">{title}</h3>
        {description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-2">{description}</p>
        )}
        
        <div className="flex flex-wrap gap-2 mt-2">
          <div className="flex items-center text-xs text-gray-500">
            <ClockIcon className="w-3 h-3 mr-1" />
            <span>{duration}</span>
          </div>
          
          {accent && (
            <div className="flex items-center text-xs text-gray-500">
              <span>Accent: {accent}</span>
            </div>
          )}
          
          {contextType && (
            <div className="flex items-center text-xs text-gray-500">
              <span>Type: {contextType}</span>
            </div>
          )}
        </div>
      </CardContent>
      
      <CardFooter className="px-4 py-2 border-t border-gray-100">
        <div className="flex items-center text-xs font-medium">
          <SkillIcon />
          <span>{skill}</span>
        </div>
      </CardFooter>
    </Card>
  );
}