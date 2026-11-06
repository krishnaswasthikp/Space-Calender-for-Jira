
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

// =====================================================
// CONFIGURATION
// =====================================================

const START_DATE_FIELD = 'customfield_10015';
const DUE_DATE_FIELD = 'duedate';

const ICS_FEED_TOKEN = process.env.ICS_FEED_TOKEN;
const JIRA_BASE_URL = 'https://swasthik-mgtech.atlassian.net';
const CALENDAR_TIME_ZONE = 'Asia/Kolkata';

// =====================================================
// DATE UTILITIES
// =====================================================

function isValidDate(value) {
    return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value)
    );
}

function addOneDay(dateString) {
    const date = new Date(`${dateString}T00:00:00.000Z`);

    date.setUTCDate(date.getUTCDate() + 1);

    return date.toISOString().slice(0, 10);
}

// Get today's date using Indian Standard Time.
function getTodayDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: CALENDAR_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const values = {};

    for (const part of parts) {
        if (part.type !== 'literal') {
            values[part.type] = part.value;
        }
    }

    return `${values.year}-${values.month}-${values.day}`;
}

// =====================================================
// DESCRIPTION CONVERSION
// =====================================================

function convertDescription(description) {
    if (!description) {
        return '';
    }

    if (typeof description === 'string') {
        return description;
    }

    const result = [];

    function traverse(node) {
        if (!node || typeof node !== 'object') {
            return;
        }

        if (node.type === 'text' && node.text) {
            result.push(node.text);
        }

        if (node.type === 'hardBreak') {
            result.push('\n');
        }

        if (Array.isArray(node.content)) {
            node.content.forEach(traverse);
        }
    }

    traverse(description);

    return result.join('');
}

// =====================================================
// FETCH JIRA ISSUES WITHIN A DATE RANGE
// =====================================================

async function getCalendarIssues(startDate, endDate) {
    const jql =
        `cf[10015] <= "${endDate}" ` +
        `AND duedate >= "${startDate}" ` +
        'ORDER BY cf[10015] ASC';

    const fields = [
        'summary',
        'description',
        START_DATE_FIELD,
        DUE_DATE_FIELD
    ].join(',');

    const allIssues = [];
    let nextPageToken = null;

    do {
        const response = nextPageToken
            ? await api.asApp().requestJira(
                route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100&nextPageToken=${nextPageToken}`
            )
            : await api.asApp().requestJira(
                route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100`
            );

        if (!response.ok) {
            throw new Error(
                `Jira search failed: ${await response.text()}`
            );
        }

        const page = await response.json();

        allIssues.push(...(page.issues || []));

        nextPageToken = page.nextPageToken || null;

    } while (nextPageToken);

    return allIssues;
}

// =====================================================
// FETCH ACTIVE AND UPCOMING ISSUES FOR ICS FEED
// =====================================================

async function getAllCalendarIssues() {
    const today = getTodayDate();

    // Retrieve only issues whose due date is today or later.
    const jql =
        'cf[10015] is not EMPTY ' +
        `AND duedate >= "${today}" ` +
        'ORDER BY cf[10015] ASC';

    const fields = [
        'summary',
        'description',
        START_DATE_FIELD,
        DUE_DATE_FIELD
    ].join(',');

    const allIssues = [];
    let nextPageToken = null;

    do {
        const response = nextPageToken
            ? await api.asApp().requestJira(
                route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100&nextPageToken=${nextPageToken}`
            )
            : await api.asApp().requestJira(
                route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100`
            );

        if (!response.ok) {
            throw new Error(
                `Jira search failed: ${await response.text()}`
            );
        }

        const page = await response.json();

        allIssues.push(...(page.issues || []));

        nextPageToken = page.nextPageToken || null;

    } while (nextPageToken);

    return allIssues;
}

// =====================================================
// RESOLVER: GET CALENDAR EVENTS
// =====================================================

resolver.define('getCalendarEvents', async ({ payload }) => {
    const startDate = payload?.start || payload?.startDate;
    const endDate = payload?.end || payload?.endDate;

    if (
        !isValidDate(startDate) ||
        !isValidDate(endDate)
    ) {
        throw new Error('Invalid calendar date range.');
    }

    // Get today's date using Indian Standard Time.
    const today = getTodayDate();

    const issues = await getCalendarIssues(
        startDate,
        endDate
    );

    return issues.map((issue) => {
        const start = issue.fields[START_DATE_FIELD];
        const due = issue.fields[DUE_DATE_FIELD];

        if (
            !isValidDate(start) ||
            !isValidDate(due) ||
            due < start
        ) {
            return null;
        }

        // Exclude events whose due date has already passed.
        if (due < today) {
            return null;
        }

        return {
            id: issue.key,

            title: `${issue.key}: ${issue.fields.summary || issue.key}`,

            start,

            end: addOneDay(due),

            allDay: true,

            extendedProps: {
                issueKey: issue.key,

                description: convertDescription(
                    issue.fields.description
                ),

                startDate: start,
                dueDate: due
            }
        };
    }).filter(Boolean);
});

// =====================================================
// ICS TEXT ESCAPING
// =====================================================

function escapeIcsText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/\r\n|\n|\r/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

// =====================================================
// ICS LINE FOLDING
// =====================================================

function foldIcsLine(line) {
    const parts = [];
    let current = '';

    for (const character of line) {
        if (current.length >= 70) {
            parts.push(current);
            current = ' ' + character;
        } else {
            current += character;
        }
    }

    if (current) {
        parts.push(current);
    }

    return parts.join('\r\n');
}

// =====================================================
// GENERATE ONE ICS EVENT
// =====================================================

function createIcsEvent(issue, today) {
    const startDate = issue.fields[START_DATE_FIELD];
    const dueDate = issue.fields[DUE_DATE_FIELD];

    if (
        !isValidDate(startDate) ||
        !isValidDate(dueDate) ||
        dueDate < startDate
    ) {
        return null;
    }

    // Do not include events whose due date has passed.
    if (dueDate < today) {
        return null;
    }

    const issueKey = issue.key;

    const summary =
        issue.fields.summary || issueKey;

    const description = convertDescription(
        issue.fields.description
    );

    const now = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');

    const lines = [
        'BEGIN:VEVENT',
        `UID:${issueKey}@space-calendar-jira`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${startDate.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${addOneDay(dueDate).replace(/-/g, '')}`,
        `SUMMARY:${escapeIcsText(`[${issueKey}] ${summary}`)}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        `URL:${JIRA_BASE_URL}/browse/${issueKey}`,
        'END:VEVENT'
    ];

    return lines.map(foldIcsLine).join('\r\n');
}

// =====================================================
// GENERATE COMPLETE ICS CALENDAR
// =====================================================

function generateIcsCalendar(issues) {
    const today = getTodayDate();

    const events = issues
        .map((issue) => createIcsEvent(issue, today))
        .filter(Boolean);

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Space Calendar for Jira//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Jira Calendar'
    ];

    for (const event of events) {
        lines.push(event);
    }

    lines.push('END:VCALENDAR');

    console.log('Current IST date:', today);
    console.log('Active ICS events:', events.length);

    return lines.join('\r\n') + '\r\n';
}

// =====================================================
// READ QUERY TOKEN
// =====================================================

function getSuppliedToken(request) {
    const queryParameters = request?.queryParameters;

    if (!queryParameters) {
        return null;
    }

    const value = queryParameters.token;

    if (Array.isArray(value)) {
        return value[0] || null;
    }

    return typeof value === 'string' ? value : null;
}

// =====================================================
// ICS WEB TRIGGER
// =====================================================

export async function icsFeed(request) {
    try {
        console.log('========== ICS FEED REQUEST ==========');

        const suppliedToken = getSuppliedToken(request);

        if (!ICS_FEED_TOKEN) {
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': [
                        'text/plain; charset=utf-8'
                    ]
                },
                body: 'Calendar feed is not configured.'
            };
        }

        if (
            !suppliedToken ||
            suppliedToken !== ICS_FEED_TOKEN
        ) {
            return {
                statusCode: 401,
                headers: {
                    'Content-Type': [
                        'text/plain; charset=utf-8'
                    ]
                },
                body: 'Unauthorized calendar subscription.'
            };
        }

        if (request?.method !== 'GET') {
            return {
                statusCode: 405,
                headers: {
                    'Content-Type': [
                        'text/plain; charset=utf-8'
                    ],
                    Allow: ['GET']
                },
                body: 'Method not allowed.'
            };
        }

        const issues = await getAllCalendarIssues();

        console.log(
            `Jira issues fetched: ${issues.length}`
        );

        const calendar = generateIcsCalendar(issues);

        console.log('ICS calendar generated successfully.');

        return {
            statusCode: 200,

            headers: {
                'Content-Type': [
                    'text/calendar; charset=utf-8'
                ],

                'Content-Disposition': [
                    'inline; filename="jira-calendar.ics"'
                ],

                'Cache-Control': ['no-store']
            },

            body: calendar
        };

    } catch (error) {
        console.error(
            'ICS feed generation failed:',
            error
        );

        return {
            statusCode: 500,

            headers: {
                'Content-Type': [
                    'text/plain; charset=utf-8'
                ]
            },

            body: 'Unable to generate Jira calendar feed.'
        };
    }
}

// =====================================================
// EXPORT RESOLVER
// =====================================================

export const handler = resolver.getDefinitions();
