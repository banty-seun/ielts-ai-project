import React from 'react';
import { cn } from '../../lib/utils';
import { Headphones, BookOpen, MessageSquare, Mic, Lock } from 'lucide-react';
import { Link } from 'wouter';

interface SkillCardProps {
  name: string;
  icon: React.ReactNode;
  score?: number | string;
  enabled: boolean;
  href?: string;
  onClick?: () => void;
}

function SkillCard({ name, icon, score, enabled, href, onClick }: SkillCardProps) {
  const content = (
    <div
      className={cn(
        'flex flex-col items-center justify-center',
        'w-28 h-32 md:w-32 md:h-36',
        'rounded-xl',
        'transition-all duration-200',
        enabled
          ? 'bg-white border border-gray-200 shadow-sm hover:shadow-md hover:scale-105 cursor-pointer'
          : 'bg-gray-50 border border-dashed border-gray-300 opacity-60 cursor-not-allowed'
      )}
      onClick={enabled ? onClick : undefined}
    >
      {/* Icon */}
      <div className={cn(
        'mb-2',
        enabled ? 'text-blue-600' : 'text-gray-400'
      )}>
        {icon}
      </div>

      {/* Skill Name */}
      <span className={cn(
        'text-sm font-medium mb-1',
        enabled ? 'text-gray-900' : 'text-gray-500'
      )}>
        {name}
      </span>

      {/* Score or Coming Soon */}
      {enabled ? (
        score !== undefined && (
          <span className="text-lg font-semibold text-gray-900">
            {score}
          </span>
        )
      ) : (
        <div className="flex flex-col items-center gap-1">
          <Lock className="h-4 w-4 text-gray-400" />
          <span className="text-xs text-gray-500">Coming Soon</span>
        </div>
      )}
    </div>
  );

  if (enabled && href) {
    return (
      <Link href={href}>
        {content}
      </Link>
    );
  }

  return content;
}

interface QuickPracticeStripProps {
  listeningScore?: number | string;
  className?: string;
}

export default function QuickPracticeStrip({ listeningScore = 'N/A', className }: QuickPracticeStripProps) {
  const handleDisabledClick = (skillName: string) => {
    // Could show a toast notification here
    console.log(`${skillName} practice coming soon!`);
  };

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium text-gray-900">Quick Practice</h2>
      </div>

      {/* Mobile: Horizontal Scroll */}
      <div className="flex md:hidden gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
        <SkillCard
          name="Listening"
          icon={<Headphones className="h-8 w-8" />}
          score={listeningScore}
          enabled={true}
          href="/practice/listening"
        />
        <SkillCard
          name="Reading"
          icon={<BookOpen className="h-8 w-8" />}
          enabled={false}
          onClick={() => handleDisabledClick('Reading')}
        />
        <SkillCard
          name="Writing"
          icon={<MessageSquare className="h-8 w-8" />}
          enabled={false}
          onClick={() => handleDisabledClick('Writing')}
        />
        <SkillCard
          name="Speaking"
          icon={<Mic className="h-8 w-8" />}
          enabled={false}
          onClick={() => handleDisabledClick('Speaking')}
        />
      </div>

      {/* Desktop: Grid */}
      <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SkillCard
          name="Listening"
          icon={<Headphones className="h-10 w-10" />}
          score={listeningScore}
          enabled={true}
          href="/practice/listening"
        />
        <SkillCard
          name="Reading"
          icon={<BookOpen className="h-10 w-10" />}
          enabled={false}
          onClick={() => handleDisabledClick('Reading')}
        />
        <SkillCard
          name="Writing"
          icon={<MessageSquare className="h-10 w-10" />}
          enabled={false}
          onClick={() => handleDisabledClick('Writing')}
        />
        <SkillCard
          name="Speaking"
          icon={<Mic className="h-10 w-10" />}
          enabled={false}
          onClick={() => handleDisabledClick('Speaking')}
        />
      </div>

      {/* Helper text for coming soon skills */}
      <p className="text-xs text-gray-500 mt-3 text-center md:text-left">
        Reading, Writing, and Speaking modules launching soon!
      </p>
    </div>
  );
}
