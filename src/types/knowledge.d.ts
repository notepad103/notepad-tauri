export interface KnowledgeNode {
  id: string;
  label: string;
  node_type: string;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  label: string;
  description: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}
