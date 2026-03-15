import { useEffect, useState } from 'react';
import type { ExportedGraph } from '../../services/graph-exporter';
import type { GraphData } from '../types/graph';

export function useGraphData() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);

  useEffect(() => {
    fetch('/api/graph')
      .then((res) => res.json())
      .then((data: ExportedGraph) => {
        setGraphData({
          ...data,
          stats: {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            featureCount: data.features.length,
          },
        });
      })
      .catch((err) => console.error('Failed to load graph data:', err));
  }, []);

  return graphData;
}
