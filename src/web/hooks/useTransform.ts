import { useRef, useState } from 'react';
import type { D3Node, Transform } from '../types/graph';

export function useTransform() {
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });

  const updateTransform = (newTransform: Transform) => {
    transformRef.current = newTransform;
    setTransform(newTransform);
  };

  const handleZoomIn = () => {
    const newTransform = {
      ...transformRef.current,
      scale: Math.min(transformRef.current.scale * 1.2, 5)
    };
    updateTransform(newTransform);
  };

  const handleZoomOut = () => {
    const newTransform = {
      ...transformRef.current,
      scale: Math.max(transformRef.current.scale / 1.2, 0.1)
    };
    updateTransform(newTransform);
  };

  const handleFitToWindow = (
    nodes: D3Node[],
    canvasWidth: number,
    canvasHeight: number,
    devicePixelRatio: number
  ) => {
    if (nodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    nodes.forEach((node) => {
      if (node.x && node.y) {
        const margin = node.radius || 20;
        minX = Math.min(minX, node.x - margin);
        maxX = Math.max(maxX, node.x + margin);
        minY = Math.min(minY, node.y - margin);
        maxY = Math.max(maxY, node.y + margin);
      }
    });

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    const width = canvasWidth / devicePixelRatio;
    const height = canvasHeight / devicePixelRatio;

    const scale = Math.min(
      (width * 0.8) / graphWidth,
      (height * 0.8) / graphHeight
    );

    const newTransform = {
      x: width / 2 - graphCenterX * scale,
      y: height / 2 - graphCenterY * scale,
      scale,
    };

    updateTransform(newTransform);
  };

  return {
    transform,
    transformRef,
    handleZoomIn,
    handleZoomOut,
    handleFitToWindow,
  };
}
