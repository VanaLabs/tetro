'use client';
import { ModelPicker } from './ModelPicker';
export function SummaryModelPicker({ onGetMore }: { onGetMore: () => void }) {
  return <ModelPicker purpose="notes" onGetMore={onGetMore} />;
}
