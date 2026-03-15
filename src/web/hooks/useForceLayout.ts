import { useEffect, useRef, useCallback } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  SimulationNodeDatum,
  SimulationLinkDatum,
} from 'd3-force';
import type { Node, Edge } from '@xyflow/react';

interface ForceNode extends SimulationNodeDatum {
  id: string;
}

export function useForceLayout(
  initialNodes: Node[],
  initialEdges: Edge[],
  onUpdate: (nodes: Node[]) => void,
  enabled: boolean = true
) {
  const simulationRef = useRef<ReturnType<typeof forceSimulation<ForceNode>> | null>(null);
  const forceNodesRef = useRef<ForceNode[]>([]);
  const onUpdateRef = useRef(onUpdate);

  // Keep onUpdate ref current
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  // Create a stable node ID list key for dependency
  const nodeIdsKey = initialNodes.map(n => n.id).sort().join(',');
  const edgeIdsKey = initialEdges.map(e => `${e.source}-${e.target}`).sort().join(',');

  useEffect(() => {
    if (!enabled || initialNodes.length === 0) {
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
      return;
    }

    // Stop any existing simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    // Create force nodes with initial positions
    const forceNodes: ForceNode[] = initialNodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
    }));
    forceNodesRef.current = forceNodes;

    // Create force links
    const forceLinks: SimulationLinkDatum<ForceNode>[] = initialEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }));

    // Create simulation
    const simulation = forceSimulation<ForceNode>(forceNodes)
      .force(
        'link',
        forceLink<ForceNode, SimulationLinkDatum<ForceNode>>(forceLinks)
          .id((d) => d.id)
          .distance(150)
          .strength(0.5)
      )
      .force('charge', forceManyBody().strength(-800))
      .force('center', forceCenter(500, 400))
      .force('collide', forceCollide().radius(60).strength(0.7))
      .alphaDecay(0.02)
      .on('tick', () => {
        // Update node positions
        const updatedNodes = initialNodes.map((node) => {
          const forceNode = forceNodesRef.current.find((fn) => fn.id === node.id);
          if (!forceNode) return node;

          return {
            ...node,
            position: {
              x: forceNode.x ?? node.position.x,
              y: forceNode.y ?? node.position.y,
            },
          };
        });

        onUpdateRef.current(updatedNodes);
      });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [nodeIdsKey, edgeIdsKey, enabled]);

  const restartSimulation = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.alpha(1).restart();
    }
  }, []);

  const stopSimulation = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.stop();
    }
  }, []);

  return {
    restartSimulation,
    stopSimulation,
  };
}
