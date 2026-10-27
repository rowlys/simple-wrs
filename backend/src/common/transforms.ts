// class-transformer @Transform helpers for request DTOs. Non-strings pass through untouched so
// @IsString reports them.

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// For optional text: an empty or whitespace-only value is stored as null (D-12).
export const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
