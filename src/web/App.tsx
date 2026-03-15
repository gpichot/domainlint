import React, { useState } from 'react';
import { useGraphData } from './hooks/useGraphData';
import { Sidebar } from './components/Sidebar';
import { GraphCanvas } from './components/GraphCanvas';

export function App() {
  const graphData = useGraphData();
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [useForceLayout, setUseForceLayout] = useState(true);

  if (!graphData) {
    return (
      <div style={styles.loading}>
        <div>Loading graph data...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <Sidebar
        graphData={graphData}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onFitToWindow={() => {}}
        selectedFeature={selectedFeature}
        onSelectFeature={setSelectedFeature}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        useForceLayout={useForceLayout}
        onToggleForceLayout={() => setUseForceLayout(!useForceLayout)}
      />
      <div style={styles.canvasContainer}>
        <GraphCanvas
          graphData={graphData}
          isCollapsed={isCollapsed}
          selectedFeature={selectedFeature}
          searchTerm={searchTerm}
          hoveredNode={hoveredNode}
          onHoveredNodeChange={setHoveredNode}
          forceLayoutEnabled={useForceLayout}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
  },
  canvasContainer: {
    flex: 1,
    position: 'relative',
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    fontSize: '18px',
  },
};
