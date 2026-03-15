import React from 'react';

const styles: Record<string, React.CSSProperties> = {
  legend: {
    marginTop: '30px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    marginBottom: '10px',
    color: '#cccccc',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px',
    fontSize: '12px',
    color: '#d4d4d4',
  },
  legendColor: {
    width: '20px',
    height: '4px',
    borderRadius: '2px',
  },
};

export function Legend() {
  return (
    <div style={styles.legend}>
      <h3 style={styles.sectionTitle}>Legend</h3>
      <div style={styles.legendItem}>
        <div style={{ ...styles.legendColor, backgroundColor: '#4a4a4a' }} />
        <span>Normal Dependency</span>
      </div>
      <div style={styles.legendItem}>
        <div style={{ ...styles.legendColor, backgroundColor: '#cc3333' }} />
        <span>Coupling (Bidirectional)</span>
      </div>
    </div>
  );
}
