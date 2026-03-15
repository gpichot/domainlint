import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import type { ExportedGraph } from '../../services/graph-exporter';

export interface GraphData extends ExportedGraph {
  stats?: {
    nodeCount: number;
    edgeCount: number;
    featureCount: number;
  };
}

export interface D3Node extends SimulationNodeDatum {
  id: string;
  label: string;
  fileCount?: number;
  feature?: string;
  radius: number;
  width?: number;
  height?: number;
}

export interface D3Link extends SimulationLinkDatum<D3Node> {
  count?: number;
  isCoupling?: boolean;
}

export interface Transform {
  x: number;
  y: number;
  scale: number;
}
