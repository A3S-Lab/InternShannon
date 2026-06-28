const STATUS_PREFIX = {
    ok: '[OK]',
    warn: '[WARN]',
    fail: '[FAIL]',
};

export function createDoctorCheck({ status, label, summary, details = [], action = '' }) {
    if (!['ok', 'warn', 'fail'].includes(status)) {
        throw new Error(`Unknown desktop doctor status: ${status}`);
    }

    return {
        action: String(action || '').trim(),
        details: compactLines(details),
        label: String(label || 'Check').trim(),
        status,
        summary: String(summary || '').trim(),
    };
}

export function classifyCommandCheck({
    command,
    exitCode,
    label,
    remediation = '',
    required = true,
    stderr = '',
    stdout = '',
}) {
    const output = firstNonEmptyLine(stdout, stderr);
    if (exitCode === 0) {
        return createDoctorCheck({
            label,
            status: 'ok',
            summary: output ? `${command} -> ${output}` : `${command} is available`,
        });
    }

    const status = required ? 'fail' : 'warn';
    return createDoctorCheck({
        action: remediation,
        details: [firstNonEmptyLine(stderr, stdout), `Command: ${command}`],
        label,
        status,
        summary: `${command} failed (${formatExitCode(exitCode)})`,
    });
}

export function classifyPathCheck({ exists, label, path, remediation = '', required = false }) {
    if (exists) {
        return createDoctorCheck({
            label,
            status: 'ok',
            summary: `${path} exists`,
        });
    }

    return createDoctorCheck({
        action: remediation,
        label,
        status: required ? 'fail' : 'warn',
        summary: `${path} is missing`,
    });
}

export function classifyApiPortCheck({ error = '', healthy = false, listening, owner = '', port }) {
    if (listening === 'unknown') {
        return createDoctorCheck({
            action: `Run lsof -nP -iTCP:${port} -sTCP:LISTEN if you need the process owner.`,
            details: [error],
            label: 'Desktop API port',
            status: 'warn',
            summary: `Could not confirm whether ${port} is free`,
        });
    }

    if (!listening) {
        return createDoctorCheck({
            label: 'Desktop API port',
            status: 'ok',
            summary: `${port} is free for the desktop sidecar`,
        });
    }

    if (healthy) {
        return createDoctorCheck({
            details: [owner],
            label: 'Desktop API port',
            status: 'ok',
            summary: `${port} already has a healthy desktop API`,
        });
    }

    return createDoctorCheck({
        action: `Stop the process on ${port}, or retry after confirming it is the internShannon desktop sidecar.`,
        details: [owner, error],
        label: 'Desktop API port',
        status: 'fail',
        summary: `${port} is occupied but /api/v1/health is not healthy`,
    });
}

export function classifyWebPortCheck({ error = '', listening, owner = '', port }) {
    if (listening === 'unknown') {
        return createDoctorCheck({
            action: `Run lsof -nP -iTCP:${port} -sTCP:LISTEN if fixed web port diagnosis matters.`,
            details: [error],
            label: 'Desktop web port',
            status: 'warn',
            summary: `Could not confirm whether ${port} is free`,
        });
    }

    if (!listening) {
        return createDoctorCheck({
            label: 'Desktop web port',
            status: 'ok',
            summary: `${port} is free for the desktop web dev server`,
        });
    }

    return createDoctorCheck({
        action: 'just dev can choose another web port; set PUBLIC_DESKTOP_DEV_PORT if you need a fixed one.',
        details: [owner],
        label: 'Desktop web port',
        status: 'warn',
        summary: `${port} is already in use`,
    });
}

export function parseLsofListenOutput(stdout = '') {
    return String(stdout)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !line.startsWith('COMMAND '))
        .map(line => {
            const columns = line.split(/\s+/);
            return {
                command: columns[0] || '',
                name: columns.slice(8).join(' '),
                pid: columns[1] || '',
            };
        })
        .filter(record => record.pid);
}

export function hasDoctorFailures(checks) {
    return checks.some(check => check.status === 'fail');
}

export function summarizeDoctorChecks(checks) {
    return checks.reduce(
        (summary, check) => {
            summary[check.status] += 1;
            return summary;
        },
        { fail: 0, ok: 0, warn: 0 },
    );
}

export function formatDoctorReport(checks, { title = 'desktop-doctor: internShannon desktop local preflight' } = {}) {
    const summary = summarizeDoctorChecks(checks);
    const lines = [title, `Checks: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail`, ''];

    for (const check of checks) {
        lines.push(`${STATUS_PREFIX[check.status]} ${check.label}: ${check.summary}`);
        for (const detail of check.details) {
            lines.push(`      ${detail}`);
        }
        if (check.action) {
            lines.push(`      Next: ${check.action}`);
        }
    }

    lines.push('');
    if (summary.fail > 0) {
        lines.push('Result: FAIL - fix the failed checks before starting the desktop client.');
    } else if (summary.warn > 0) {
        lines.push('Result: WARN - desktop local can usually start, but review the warnings.');
    } else {
        lines.push('Result: OK - desktop local is ready to start.');
    }
    lines.push('Cloud/Docker checks are intentionally skipped for the first desktop-local phase.');

    return lines.join('\n');
}

function compactLines(lines) {
    return lines.map(line => String(line || '').trim()).filter(Boolean);
}

function firstNonEmptyLine(...values) {
    return compactLines(values.join('\n').split(/\r?\n/))[0] || '';
}

function formatExitCode(exitCode) {
    return exitCode === null || exitCode === undefined ? 'no exit code' : `exit ${exitCode}`;
}
