import React from 'react';
import { Handle, Position } from '@xyflow/react';

interface FileNodeProps {
  data: {
    label: string;
    shortLabel: string;
    color: string;
    isHighlighted: boolean;
    isDimmed: boolean;
  };
}

export function FileNode({ data }: FileNodeProps) {
  const opacity = data.isDimmed ? 0.3 : 1;
  const fontSize = data.isHighlighted ? '11px' : '10px';
  const fontWeight = data.isHighlighted ? 'bold' : 'normal';

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity,
        }}
      >
        <div
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            backgroundColor: data.color,
            boxShadow: data.isHighlighted
              ? `0 0 15px ${data.color}`
              : 'none',
            transition: 'all 0.2s',
          }}
        />
        <div
          style={{
            marginTop: '4px',
            color: '#d4d4d4',
            fontSize,
            fontWeight,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {data.shortLabel}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}
