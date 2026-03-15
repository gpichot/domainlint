import React from 'react';
import { Handle, Position } from '@xyflow/react';

interface FeatureNodeProps {
  data: {
    label: string;
    fileCount: number;
    color: string;
    isHighlighted: boolean;
    isDimmed: boolean;
  };
}

export function FeatureNode({ data }: FeatureNodeProps) {
  const opacity = data.isDimmed ? 0.3 : 1;
  const fontSize = data.isHighlighted ? '16px' : '14px';
  const fontWeight = 'bold';

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        style={{
          padding: '16px 24px',
          borderRadius: '25px',
          backgroundColor: data.color,
          opacity,
          boxShadow: data.isHighlighted
            ? `0 0 20px ${data.color}`
            : '0 2px 8px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.2s',
          minWidth: '100px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            color: '#1e1e1e',
            fontSize,
            fontWeight,
            fontFamily: 'monospace',
            marginBottom: '4px',
          }}
        >
          {data.label}
        </div>
        <div
          style={{
            color: '#1e1e1e',
            fontSize: '11px',
            fontFamily: 'monospace',
          }}
        >
          {data.fileCount} files
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}
