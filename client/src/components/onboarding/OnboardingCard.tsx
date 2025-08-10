import React, { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface OnboardingCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function OnboardingCard({
  title,
  description,
  children,
  icon,
  className,
}: OnboardingCardProps) {
  return (
    <div className={cn("flex flex-col flex-1", className)}>
      {/* Card Header */}
      <div className="mb-6">
        {icon && <div className="mb-4">{icon}</div>}
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">{title}</h1>
        {description && (
          <p className="text-gray-600 text-base">{description}</p>
        )}
      </div>

      {/* Card Content */}
      <div className="flex-1 flex flex-col">
        {children}
      </div>
    </div>
  );
}