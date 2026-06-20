import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Document } from '../../documents/entities/document.entity';

export interface SourceUsed {
  chunkIndex: number;
  pageNumber: number;
  contentPreview: string;
}

@Entity('questions')
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Document, (doc) => doc.questions, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'document_id' })
  document!: Document;

  @Index()
  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'text' })
  answer!: string;

  @Column({ type: 'boolean', name: 'is_grounded' })
  isGrounded!: boolean;

  @Column({ type: 'float', name: 'grounding_confidence' })
  groundingConfidence!: number;

  @Column({ type: 'text', array: true, name: 'unsupported_claims', default: () => "'{}'" })
  unsupportedClaims!: string[];

  @Column({ type: 'jsonb', name: 'sources_used' })
  sourcesUsed!: SourceUsed[];

  @Column({ type: 'int', name: 'processing_time_ms' })
  processingTimeMs!: number;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
