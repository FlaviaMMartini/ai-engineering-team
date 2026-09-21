import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import type { TokenUsageDto } from '../types/api.js';
import { formatTokenCount } from '../utils/format.js';

export interface TokenMetricsProps {
  tokens: TokenUsageDto;
}

/** Actual token usage aggregated by the backend's execution read model — never recomputed here. */
export function TokenMetrics({ tokens }: TokenMetricsProps) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Input</TableCell>
          <TableCell>Output</TableCell>
          <TableCell>Cache creation</TableCell>
          <TableCell>Cache read</TableCell>
          <TableCell>Total</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell sx={{ fontFamily: 'monospace' }}>{formatTokenCount(tokens.input)}</TableCell>
          <TableCell sx={{ fontFamily: 'monospace' }}>{formatTokenCount(tokens.output)}</TableCell>
          <TableCell sx={{ fontFamily: 'monospace' }}>{formatTokenCount(tokens.cacheCreation)}</TableCell>
          <TableCell sx={{ fontFamily: 'monospace' }}>{formatTokenCount(tokens.cacheRead)}</TableCell>
          <TableCell sx={{ fontFamily: 'monospace' }}>{formatTokenCount(tokens.total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
