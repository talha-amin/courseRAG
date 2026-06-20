import { plainToInstance } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsNumberString,
  IsIn,
  validateSync,
  MinLength,
} from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsOptional()
  @IsNumberString()
  PORT?: string;

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  DATABASE_SSL?: string;

  @IsString()
  @MinLength(1)
  OPENAI_API_KEY!: string;

  @IsOptional()
  @IsString()
  OPENAI_EMBEDDING_MODEL?: string;

  @IsString()
  @MinLength(1)
  ANTHROPIC_API_KEY!: string;

  @IsOptional()
  @IsString()
  ANTHROPIC_MODEL?: string;

  @IsOptional()
  @IsNumberString()
  MAX_FILE_SIZE_MB?: string;

  @IsOptional()
  @IsNumberString()
  DEFAULT_TOP_K?: string;

  @IsOptional()
  @IsNumberString()
  CHUNK_TARGET_TOKENS?: string;

  @IsOptional()
  @IsNumberString()
  CHUNK_OVERLAP_TOKENS?: string;
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const config = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(config, {
    skipMissingProperties: false,
    forbidUnknownValues: false,
  });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Environment validation failed — ${messages}`);
  }
  return config;
}
