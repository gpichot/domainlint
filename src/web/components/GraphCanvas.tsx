import React, { useMemo, useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
  ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphData } from '../types/graph';
import { FeatureNode } from './FeatureNode';
import { FileNode } from './FileNode';
import { useForceLayout } from '../hooks/useForceLayout';

interface GraphCanvasProps {
  graphData: GraphData;
  isCollapsed: boolean;
  selectedFeature: string | null;
  searchTerm: string;
  hoveredNode: string | null;
  onHoveredNodeChange: (nodeId: string | null) => void;
  forceLayoutEnabled: boolean;
}

const COLORS = [
  '#61AFEF', '#E06C75', '#98C379', '#E5C07B', '#C678DD',
  '#56B6C2', '#D19A66', '#ABB2BF',
];

const nodeTypes = {
  feature: FeatureNode,
  file: FileNode,
};

export function GraphCanvas({
  graphData,
  isCollapsed,
  selectedFeature,
  searchTerm,
  hoveredNode,
  onHoveredNodeChange,
  forceLayoutEnabled,
}: GraphCanvasProps) {

  const getColor = (feature: string) => {
    const index = graphData.features.indexOf(feature);
    return index >= 0 ? COLORS[index % COLORS.length] : '#888';
  };

  // Calculate connected nodes for highlighting
  const getConnectedNodes = useCallback((nodeId: string, edges: Edge[]) => {
    const deps = new Set<string>();
    const dependents = new Set<string>();

    edges.forEach((edge) => {
      if (edge.source === nodeId) deps.add(edge.target);
      if (edge.target === nodeId) dependents.add(edge.source);
    });

    return { deps, dependents };
  }, []);

  // Build React Flow nodes and edges
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (isCollapsed) {
      // Feature-level view
      const filteredFeatureNodes = selectedFeature
        ? graphData.featureGraph.nodes.filter((node) => node.id === selectedFeature)
        : graphData.featureGraph.nodes;

      const nodeIds = new Set(filteredFeatureNodes.map((n) => n.id));
      const filteredFeatureEdges = graphData.featureGraph.edges.filter(
        (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)
      );

      // Detect coupling and create edge map
      const couplingPairs = new Set<string>();
      const processedEdges = new Set<string>();
      const edgeMap = new Map<string, typeof filteredFeatureEdges[0]>();

      filteredFeatureEdges.forEach((edge) => {
        edgeMap.set(`${edge.from}-${edge.to}`, edge);
      });

      filteredFeatureEdges.forEach((edge) => {
        const reverseEdge = edgeMap.get(`${edge.to}-${edge.from}`);
        if (reverseEdge && !processedEdges.has(`${edge.to}-${edge.from}`)) {
          // Bidirectional edge found
          const pairKey = [edge.from, edge.to].sort().join('-');
          couplingPairs.add(pairKey);
          processedEdges.add(`${edge.from}-${edge.to}`);
          processedEdges.add(`${edge.to}-${edge.from}`);
        }
      });

      // Create nodes with initial positions (will be adjusted by force layout)
      const nodes: Node[] = filteredFeatureNodes.map((node, index) => {
        // Start with a slight circular spread to help the force layout converge faster
        const angle = (index / filteredFeatureNodes.length) * Math.PI * 2;
        const radius = 100;

        return {
          id: node.id,
          type: 'feature',
          position: {
            x: 500 + Math.cos(angle) * radius,
            y: 400 + Math.sin(angle) * radius,
          },
          data: {
            label: node.label,
            fileCount: node.fileCount,
            color: getColor(node.id),
            isHighlighted: false,
            isDimmed: false,
          },
          draggable: true,
        };
      });

      // Create edges - for bidirectional, create only one edge with two arrows
      const edges: Edge[] = [];
      const handledPairs = new Set<string>();

      filteredFeatureEdges.forEach((edge) => {
        const pairKey = [edge.from, edge.to].sort().join('-');

        if (handledPairs.has(pairKey)) {
          return; // Skip if we already handled this pair
        }

        const isBidirectional = couplingPairs.has(pairKey);
        const reverseEdge = edgeMap.get(`${edge.to}-${edge.from}`);

        if (isBidirectional) {
          // Create a single bidirectional edge with arrows on both ends
          const totalCount = edge.count + (reverseEdge?.count || 0);
          edges.push({
            id: `${edge.from}-${edge.to}`,
            source: edge.from,
            target: edge.to,
            type: ConnectionLineType.Bezier,
            animated: false,
            label: `${totalCount}`,
            labelStyle: { fill: '#cc3333', fontWeight: 'bold', fontSize: '11px' },
            style: {
              stroke: '#cc3333',
              strokeWidth: 3,
            },
            markerStart: {
              type: MarkerType.ArrowClosed,
              color: '#cc3333',
              width: 20,
              height: 20,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#cc3333',
              width: 20,
              height: 20,
            },
          });
          handledPairs.add(pairKey);
        } else {
          // Regular unidirectional edge
          edges.push({
            id: `${edge.from}-${edge.to}`,
            source: edge.from,
            target: edge.to,
            type: ConnectionLineType.Bezier,
            animated: false,
            label: `${edge.count}`,
            labelStyle: { fill: '#858585', fontWeight: 'bold', fontSize: '11px' },
            style: {
              stroke: '#4a4a4a',
              strokeWidth: 2,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#4a4a4a',
              width: 20,
              height: 20,
            },
          });
        }
      });

      return { nodes, edges };
    } else {
      // File-level view
      const filteredNodes = graphData.nodes.filter((node) => {
        const matchesFeature = !selectedFeature || node.feature === selectedFeature;
        const matchesSearch = !searchTerm || node.label.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesFeature && matchesSearch;
      });

      const nodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = graphData.edges.filter(
        (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)
      );

      // Detect bidirectional edges
      const couplingPairs = new Set<string>();
      const processedEdges = new Set<string>();
      const edgeMap = new Map<string, typeof filteredEdges[0]>();

      filteredEdges.forEach((edge) => {
        edgeMap.set(`${edge.from}-${edge.to}`, edge);
      });

      filteredEdges.forEach((edge) => {
        const reverseEdge = edgeMap.get(`${edge.to}-${edge.from}`);
        if (reverseEdge && !processedEdges.has(`${edge.to}-${edge.from}`)) {
          const pairKey = [edge.from, edge.to].sort().join('-');
          couplingPairs.add(pairKey);
          processedEdges.add(`${edge.from}-${edge.to}`);
          processedEdges.add(`${edge.to}-${edge.from}`);
        }
      });

      // Create nodes with initial positions (will be adjusted by force layout)
      const nodes: Node[] = filteredNodes.map((node, index) => {
        // Start with a slight circular spread to help the force layout converge faster
        const angle = (index / filteredNodes.length) * Math.PI * 2;
        const radius = 150;
        const parts = node.label.split('/');
        const shortLabel = parts[parts.length - 1].replace(/\.(ts|js|tsx|jsx)$/, '');

        return {
          id: node.id,
          type: 'file',
          position: {
            x: 500 + Math.cos(angle) * radius,
            y: 400 + Math.sin(angle) * radius,
          },
          data: {
            label: node.label,
            shortLabel,
            color: node.feature ? getColor(node.feature) : '#888',
            isHighlighted: false,
            isDimmed: false,
          },
          draggable: true,
        };
      });

      // Create edges - for bidirectional, create only one edge with two arrows
      const edges: Edge[] = [];
      const handledPairs = new Set<string>();

      filteredEdges.forEach((edge) => {
        const pairKey = [edge.from, edge.to].sort().join('-');

        if (handledPairs.has(pairKey)) {
          return;
        }

        const isBidirectional = couplingPairs.has(pairKey);

        if (isBidirectional) {
          // Create a single bidirectional edge with arrows on both ends
          edges.push({
            id: `${edge.from}-${edge.to}`,
            source: edge.from,
            target: edge.to,
            type: ConnectionLineType.Bezier,
            animated: false,
            style: {
              stroke: '#cc3333',
              strokeWidth: 2,
            },
            markerStart: {
              type: MarkerType.ArrowClosed,
              color: '#cc3333',
              width: 15,
              height: 15,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#cc3333',
              width: 15,
              height: 15,
            },
          });
          handledPairs.add(pairKey);
        } else {
          // Regular unidirectional edge
          edges.push({
            id: `${edge.from}-${edge.to}`,
            source: edge.from,
            target: edge.to,
            type: ConnectionLineType.Bezier,
            animated: false,
            style: {
              stroke: '#4a4a4a',
              strokeWidth: 1,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#4a4a4a',
              width: 15,
              height: 15,
            },
          });
        }
      });

      return { nodes, edges };
    }
  }, [graphData, isCollapsed, selectedFeature, searchTerm]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when data changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Apply force layout
  const handleForceLayoutUpdate = useCallback((updatedNodes: Node[]) => {
    setNodes(updatedNodes);
  }, [setNodes]);

  useForceLayout(initialNodes, initialEdges, handleForceLayoutUpdate, forceLayoutEnabled);

  // Update highlighting when hoveredNode changes
  useEffect(() => {
    if (!hoveredNode) {
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          data: { ...node.data, isHighlighted: false, isDimmed: false },
        }))
      );
      setEdges((eds) =>
        eds.map((edge) => {
          // Determine original color based on whether it's bidirectional
          const isBidirectional = edge.markerStart !== undefined;
          const originalColor = isBidirectional ? '#cc3333' : '#4a4a4a';
          const originalLabelColor = isBidirectional ? '#cc3333' : '#858585';

          return {
            ...edge,
            style: {
              ...edge.style,
              stroke: originalColor,
              strokeWidth: isBidirectional ? (isCollapsed ? 3 : 2) : (isCollapsed ? 2 : 1),
            },
            animated: false,
            labelStyle: {
              ...edge.labelStyle,
              fill: originalLabelColor,
              fontWeight: 'bold',
              fontSize: '11px',
            },
          };
        })
      );
      return;
    }

    setNodes((nds) => {
      const { deps, dependents } = getConnectedNodes(hoveredNode, edges);

      return nds.map((node) => {
        const isHighlighted = node.id === hoveredNode;
        const isConnected = deps.has(node.id) || dependents.has(node.id);
        const isDimmed = !isHighlighted && !isConnected;

        return {
          ...node,
          data: { ...node.data, isHighlighted, isDimmed },
        };
      });
    });

    setEdges((eds) => {
      const { deps, dependents } = getConnectedNodes(hoveredNode, eds);

      return eds.map((edge) => {
        const isHighlighted =
          edge.source === hoveredNode ||
          edge.target === hoveredNode ||
          (edge.source === hoveredNode && deps.has(edge.target)) ||
          (edge.target === hoveredNode && dependents.has(edge.source));

        const isBidirectional = edge.markerStart !== undefined;
        const baseColor = isBidirectional ? '#cc3333' : '#4a4a4a';
        const highlightColor = isBidirectional ? '#ff4444' : '#61AFEF';
        const baseLabelColor = isBidirectional ? '#cc3333' : '#858585';
        const baseWidth = isBidirectional ? (isCollapsed ? 3 : 2) : (isCollapsed ? 2 : 1);
        const highlightedWidth = isBidirectional ? (isCollapsed ? 4 : 3) : (isCollapsed ? 3 : 2);

        return {
          ...edge,
          style: {
            ...edge.style,
            strokeWidth: isHighlighted ? highlightedWidth : baseWidth,
            stroke: isHighlighted ? highlightColor : baseColor,
          },
          animated: isHighlighted,
          labelStyle: {
            ...edge.labelStyle,
            fill: isHighlighted ? highlightColor : baseLabelColor,
            fontWeight: 'bold',
            fontSize: isCollapsed ? '12px' : '11px',
          },
        };
      });
    });
  }, [hoveredNode, isCollapsed, getConnectedNodes]);

  const onNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onHoveredNodeChange(node.id);
    },
    [onHoveredNodeChange]
  );

  const onNodeMouseLeave = useCallback(() => {
    onHoveredNodeChange(null);
  }, [onHoveredNodeChange]);

  return (
    <div style={{ width: '100%', height: '100%', backgroundColor: '#1e1e1e' }}>
      <ReactFlow
        key={isCollapsed ? 'collapsed' : 'expanded'}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={5}
        defaultEdgeOptions={{
          type: ConnectionLineType.Bezier,
        }}
      >
        <Background color="#3e3e42" gap={16} />
        <Controls
          style={{
            backgroundColor: '#252526',
            border: '1px solid #3e3e42',
          }}
        />
      </ReactFlow>
    </div>
  );
}
