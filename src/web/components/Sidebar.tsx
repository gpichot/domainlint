import React from 'react';
import type { GraphData } from '../types/graph';
import { Legend } from './Legend';

interface SidebarProps {
  graphData: GraphData;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToWindow: () => void;
  selectedFeature: string | null;
  onSelectFeature: (feature: string | null) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  useForceLayout: boolean;
  onToggleForceLayout: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: '300px',
    backgroundColor: '#252526',
    padding: '20px',
    overflowY: 'auto',
    borderRight: '1px solid #3e3e42',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '20px',
    color: '#61AFEF',
  },
  section: {
    marginBottom: '30px',
  },
  toggleButton: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#61AFEF',
    border: 'none',
    borderRadius: '4px',
    color: '#1e1e1e',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    transition: 'all 0.2s',
  },
  controlButtons: {
    display: 'flex',
    gap: '8px',
  },
  controlButton: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#3c3c3c',
    border: '1px solid #3e3e42',
    borderRadius: '4px',
    color: '#d4d4d4',
    cursor: 'pointer',
    fontSize: '16px',
    transition: 'all 0.2s',
  },
  stats: {
    display: 'flex',
    gap: '10px',
    marginBottom: '30px',
  },
  statItem: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    padding: '10px',
    borderRadius: '4px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#61AFEF',
  },
  statLabel: {
    fontSize: '12px',
    color: '#858585',
    marginTop: '4px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    marginBottom: '10px',
    color: '#cccccc',
  },
  input: {
    width: '100%',
    padding: '8px',
    backgroundColor: '#3c3c3c',
    border: '1px solid #3e3e42',
    borderRadius: '4px',
    color: '#d4d4d4',
    fontSize: '14px',
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  featureButton: {
    padding: '8px 12px',
    backgroundColor: '#3c3c3c',
    border: '1px solid #3e3e42',
    borderRadius: '4px',
    color: '#d4d4d4',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '14px',
    transition: 'all 0.2s',
  },
  featureButtonActive: {
    backgroundColor: '#61AFEF',
    color: '#1e1e1e',
    fontWeight: 'bold',
  },
  checkboxContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    backgroundColor: '#3c3c3c',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  checkboxLabel: {
    fontSize: '14px',
    color: '#d4d4d4',
    cursor: 'pointer',
    userSelect: 'none',
  },
};

export function Sidebar({
  graphData,
  isCollapsed,
  onToggleCollapse,
  onZoomIn,
  onZoomOut,
  onFitToWindow,
  selectedFeature,
  onSelectFeature,
  searchTerm,
  onSearchChange,
  useForceLayout,
  onToggleForceLayout,
}: SidebarProps) {
  const currentNodeCount = isCollapsed
    ? graphData.featureGraph.nodes.length
    : graphData.stats?.nodeCount || 0;
  const currentEdgeCount = isCollapsed
    ? graphData.featureGraph.edges.length
    : graphData.stats?.edgeCount || 0;

  return (
    <div style={styles.sidebar}>
      <h1 style={styles.title}>DomainLint</h1>

      <div style={styles.section}>
        <button onClick={onToggleCollapse} style={styles.toggleButton}>
          {isCollapsed ? '📊 Collapsed View (Features)' : '📁 Expanded View (Files)'}
        </button>
      </div>

      <div style={styles.section}>
        <label style={styles.checkboxContainer}>
          <input
            type="checkbox"
            checked={useForceLayout}
            onChange={onToggleForceLayout}
            style={styles.checkbox}
          />
          <span style={styles.checkboxLabel}>Use Force Layout</span>
        </label>
      </div>

      <div style={styles.section}>
        <div style={{ fontSize: '12px', color: '#858585', textAlign: 'center' }}>
          Use built-in React Flow controls (bottom-left corner)
        </div>
      </div>

      <div style={styles.stats}>
        <div style={styles.statItem}>
          <div style={styles.statValue}>{currentNodeCount}</div>
          <div style={styles.statLabel}>{isCollapsed ? 'Features' : 'Files'}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statValue}>{currentEdgeCount}</div>
          <div style={styles.statLabel}>Dependencies</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statValue}>{graphData.stats?.featureCount || 0}</div>
          <div style={styles.statLabel}>Total Features</div>
        </div>
      </div>

      {!isCollapsed && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Search</h3>
          <input
            type="text"
            placeholder="Filter files..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            style={styles.input}
          />
        </div>
      )}

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Filter by Feature</h3>
        <div style={styles.featureList}>
          <button
            onClick={() => onSelectFeature(null)}
            style={{
              ...styles.featureButton,
              ...(selectedFeature === null ? styles.featureButtonActive : {}),
            }}
          >
            All Features
          </button>
          {graphData.features.map((feature) => (
            <button
              key={feature}
              onClick={() => onSelectFeature(feature)}
              style={{
                ...styles.featureButton,
                ...(selectedFeature === feature ? styles.featureButtonActive : {}),
              }}
            >
              {feature}
            </button>
          ))}
        </div>
      </div>

      <Legend />
    </div>
  );
}
