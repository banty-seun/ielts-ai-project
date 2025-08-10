import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, BarChart3, Database, RefreshCw } from 'lucide-react';
import { logFirestoreMetricsSummary, resetFirestoreMetrics } from '@/lib/firestoreTracker';

/**
 * A development-only component that displays Firebase usage metrics
 * This component only renders in development mode and helps track Firestore operations
 */
export function FirebaseMetricsDebug() {
  const [metrics, setMetrics] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);
  
  // Only show in development mode
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  
  useEffect(() => {
    // Function to get metrics from window object
    const updateMetrics = () => {
      if (typeof window !== 'undefined' && window.firestoreMetrics) {
        setMetrics({ ...window.firestoreMetrics });
      }
    };
    
    // Initial update
    updateMetrics();
    
    // Update metrics every 3 seconds
    const interval = setInterval(updateMetrics, 3000);
    
    return () => clearInterval(interval);
  }, []);
  
  if (!metrics) return null;
  
  // Prepare read metrics
  const totalReads = metrics.reads.total;
  const topReadComponents = Object.entries(metrics.reads.byComponent)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5);
    
  const topReadCollections = Object.entries(metrics.reads.byCollection)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5);
  
  // Prepare write metrics
  const totalWrites = metrics.writes.total;
  const topWriteComponents = Object.entries(metrics.writes.byComponent)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5);
    
  const topWriteCollections = Object.entries(metrics.writes.byCollection)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5);
  
  // Calculate session duration
  const sessionDurationMs = Date.now() - metrics.sessionStartTime;
  const sessionDurationMin = Math.round(sessionDurationMs / 1000 / 60 * 10) / 10;
  
  // Handle refresh metrics
  const handleRefreshMetrics = () => {
    logFirestoreMetricsSummary();
  };
  
  // Handle reset metrics
  const handleResetMetrics = () => {
    resetFirestoreMetrics();
    setMetrics(window.firestoreMetrics);
  };
  
  return (
    <div className="fixed bottom-0 right-0 z-50 p-4 w-full md:w-auto max-w-md">
      <Card className="bg-slate-900 text-white border-slate-700 shadow-lg">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-sm font-medium flex items-center">
              <Database className="h-4 w-4 mr-2 text-orange-400" />
              Firebase Dev Metrics
              <Badge variant="outline" className="ml-2 text-xs">Dev Only</Badge>
            </CardTitle>
            <div className="flex gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6" 
                onClick={handleRefreshMetrics}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6" 
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? '−' : '+'}
              </Button>
            </div>
          </div>
          <CardDescription className="text-slate-400 text-xs">
            Session: {sessionDurationMin} min | Reads: {totalReads} | Writes: {totalWrites}
          </CardDescription>
        </CardHeader>
        
        {expanded && (
          <CardContent className="pt-0">
            <Separator className="my-2 bg-slate-700" />
            
            {/* Read metrics */}
            <div className="mb-3">
              <h4 className="text-xs font-semibold flex items-center text-orange-400 mb-1">
                <BarChart3 className="h-3 w-3 mr-1" /> Read Operations
              </h4>
              
              {totalReads === 0 ? (
                <p className="text-xs text-slate-400">No read operations yet</p>
              ) : (
                <>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-300">Top Components:</p>
                    <div className="grid grid-cols-2 gap-1">
                      {topReadComponents.map(([component, count]) => (
                        <div key={component} className="flex justify-between text-xs bg-slate-800 p-1 rounded">
                          <span className="truncate">{component}</span>
                          <span className="text-amber-400">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="space-y-1 mt-2">
                    <p className="text-xs font-medium text-slate-300">Top Collections:</p>
                    <div className="grid grid-cols-2 gap-1">
                      {topReadCollections.map(([collection, count]) => (
                        <div key={collection} className="flex justify-between text-xs bg-slate-800 p-1 rounded">
                          <span className="truncate">{collection}</span>
                          <span className="text-amber-400">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Write metrics */}
            {totalWrites > 0 && (
              <div className="mb-2">
                <h4 className="text-xs font-semibold flex items-center text-blue-400 mb-1">
                  <BarChart3 className="h-3 w-3 mr-1" /> Write Operations
                </h4>
                
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-300">Top Components:</p>
                  <div className="grid grid-cols-2 gap-1">
                    {topWriteComponents.map(([component, count]) => (
                      <div key={component} className="flex justify-between text-xs bg-slate-800 p-1 rounded">
                        <span className="truncate">{component}</span>
                        <span className="text-blue-400">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-1 mt-2">
                  <p className="text-xs font-medium text-slate-300">Top Collections:</p>
                  <div className="grid grid-cols-2 gap-1">
                    {topWriteCollections.map(([collection, count]) => (
                      <div key={collection} className="flex justify-between text-xs bg-slate-800 p-1 rounded">
                        <span className="truncate">{collection}</span>
                        <span className="text-blue-400">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex justify-between mt-3">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs border-slate-700 hover:bg-slate-800"
                onClick={handleResetMetrics}
              >
                Reset Metrics
              </Button>
              <p className="text-xs text-slate-400 italic">Only visible in development</p>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}