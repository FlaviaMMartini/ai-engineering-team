import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { DiffFileDto } from '../types/api.js';

export interface DiffViewerProps {
  files: readonly DiffFileDto[];
  additions: number;
  deletions: number;
  truncated: boolean;
}

const STATUS_LETTER: Record<string, string> = {
  ADDED: 'A',
  MODIFIED: 'M',
  DELETED: 'D',
  RENAMED: 'R',
  COPIED: 'C',
  UNKNOWN: '?'
};

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  ADDED: 'success',
  MODIFIED: 'warning',
  DELETED: 'error'
};

function diffLineSx(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) return { color: 'text.secondary' };
  if (line.startsWith('@@')) return { bgcolor: 'rgba(255, 171, 0, 0.12)', color: 'text.secondary' };
  if (line.startsWith('+')) return { bgcolor: 'rgba(54, 179, 126, 0.12)', color: 'success.dark' };
  if (line.startsWith('-')) return { bgcolor: 'rgba(222, 53, 11, 0.1)', color: 'error.dark' };
  return {};
}

/**
 * Read-only, selectable, scrollable plain-text diff — no in-browser editor,
 * no patch editing/applying, no syntax highlighting library. Every value
 * rendered here comes directly from the API response; nothing is
 * recomputed or fabricated in this component.
 */
export function DiffViewer({ files, additions, deletions, truncated }: DiffViewerProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(files[0]?.path ?? null);

  if (files.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No changes detected.
      </Typography>
    );
  }

  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', px: 1.5, py: 1, bgcolor: 'background.default', borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
          Changes
        </Typography>
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          <Box component="span" sx={{ color: 'success.dark' }}>
            +{additions}
          </Box>{' '}
          <Box component="span" sx={{ color: 'error.dark' }}>
            -{deletions}
          </Box>
        </Typography>
      </Stack>

      {truncated && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pt: 1 }}>
          Diff is too large to display completely. File list and totals are accurate; patch text has been withheld.
        </Typography>
      )}

      <List dense disablePadding sx={{ maxHeight: 220, overflowY: 'auto', borderBottom: '1px solid', borderColor: 'divider' }}>
        {files.map((file) => (
          <ListItemButton
            key={file.path}
            selected={file.path === selectedFile?.path}
            onClick={() => setSelectedPath(file.path)}
            sx={{ gap: 1 }}
          >
            <Chip size="small" label={STATUS_LETTER[file.status] ?? '?'} color={STATUS_COLOR[file.status] ?? 'default'} sx={{ minWidth: 28 }} />
            <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {file.path}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {file.binary ? 'binary' : `+${file.additions} -${file.deletions}`}
            </Typography>
          </ListItemButton>
        ))}
      </List>

      {selectedFile !== null && (
        <Box>
          <Typography variant="caption" sx={{ display: 'block', px: 1.5, py: 1, fontFamily: 'monospace', bgcolor: 'background.default' }}>
            {selectedFile.path}
          </Typography>
          {selectedFile.binary ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
              Binary file — no textual diff available.
            </Typography>
          ) : selectedFile.patch === null ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
              Patch unavailable for this file.
            </Typography>
          ) : (
            <Box component="pre" sx={{ m: 0, py: 1, maxHeight: 420, overflow: 'auto', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}>
              {selectedFile.patch.split('\n').map((line, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <Box key={index} sx={{ px: 1.5, whiteSpace: 'pre', ...diffLineSx(line) }}>
                  {line.length === 0 ? ' ' : line}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
