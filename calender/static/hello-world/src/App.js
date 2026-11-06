import React, {
    useState,
    useEffect,
    useCallback,
    useMemo
} from 'react';

import { invoke, router } from '@forge/bridge';

import './style.css';

// =====================================================
// DATE UTILITIES
// =====================================================

function formatDate(date) {
    const year = date.getFullYear();

    const month = String(date.getMonth() + 1).padStart(2, '0');

    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
    const result = new Date(date);

    result.setDate(result.getDate() + amount);

    return result;
}

function isSameDay(first, second) {
    return (
        first.getFullYear() === second.getFullYear() &&
        first.getMonth() === second.getMonth() &&
        first.getDate() === second.getDate()
    );
}

// =====================================================
// MAIN APP
// =====================================================

function App() {

    const [currentMonth, setCurrentMonth] = useState(() => {
        const today = new Date();

        return new Date(
            today.getFullYear(),
            today.getMonth(),
            1
        );
    });

    const [events, setEvents] = useState([]);

    const [loading, setLoading] = useState(false);

    const [error, setError] = useState('');

    // =================================================
    // CALENDAR RANGE
    // =================================================

    const calendarStart = useMemo(() => {
        const firstDay = new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth(),
            1
        );

        firstDay.setDate(
            firstDay.getDate() - firstDay.getDay()
        );

        return firstDay;
    }, [currentMonth]);

    const calendarEnd = useMemo(() => {
        return addDays(calendarStart, 42);
    }, [calendarStart]);

    // =================================================
    // FETCH JIRA EVENTS
    // =================================================

    const fetchEvents = useCallback(async () => {

        setLoading(true);
        setError('');

        try {

            const result = await invoke(
                'getCalendarEvents',
                {
                    start: formatDate(calendarStart),
                    end: formatDate(calendarEnd)
                }
            );

            console.log('Calendar events:', result);

            setEvents(
                Array.isArray(result) ? result : []
            );

        } catch (err) {

            console.error('Calendar error:', err);

            setError(
                err?.message ||
                'Unable to load Jira calendar events.'
            );

            setEvents([]);

        } finally {

            setLoading(false);

        }

    }, [calendarStart, calendarEnd]);

    // =================================================
    // LOAD EVENTS
    // =================================================

    useEffect(() => {
        fetchEvents();
    }, [fetchEvents]);

    // =================================================
    // GET EVENTS FOR A DAY
    // =================================================

    function getEventsForDay(day) {

        const selectedDate = formatDate(day);

        return events.filter((event) => {

            return (
                event.start <= selectedDate &&
                selectedDate < event.end
            );

        });
    }

    // =================================================
    // OPEN SPECIFIC JIRA ISSUE
    // =================================================

    async function openJiraIssue(issueKey) {

        console.log('Clicked Jira issue:', issueKey);

        if (!issueKey) {

            console.error('Issue key is missing.');

            setError('Unable to open Jira issue: issue key is missing.');

            return;
        }

        try {

            // Forge Bridge navigation API
            // Opens the selected Jira issue in the same tab.

            await router.navigate({
                target: 'issue',
                issueKey: issueKey
            });

        } catch (err) {

            console.error(
                'Unable to navigate to Jira issue:',
                err
            );

            setError(
                `Unable to open ${issueKey}. Please try again.`
            );

        }
    }

    // =================================================
    // PREVIOUS MONTH
    // =================================================

    function previousMonth() {

        setCurrentMonth((previous) => {

            return new Date(
                previous.getFullYear(),
                previous.getMonth() - 1,
                1
            );

        });
    }

    // =================================================
    // NEXT MONTH
    // =================================================

    function nextMonth() {

        setCurrentMonth((previous) => {

            return new Date(
                previous.getFullYear(),
                previous.getMonth() + 1,
                1
            );

        });
    }

    // =================================================
    // TODAY
    // =================================================

    function goToToday() {

        const today = new Date();

        setCurrentMonth(
            new Date(
                today.getFullYear(),
                today.getMonth(),
                1
            )
        );
    }

    // =================================================
    // MONTH NAME
    // =================================================

    const monthName = currentMonth.toLocaleDateString(
        'en-US',
        {
            month: 'long',
            year: 'numeric'
        }
    );

    // =================================================
    // GENERATE CALENDAR DAYS
    // =================================================

    const calendarDays = useMemo(() => {

        return Array.from(
            { length: 42 },
            (_, index) => addDays(calendarStart, index)
        );

    }, [calendarStart]);

    // =================================================
    // RENDER
    // =================================================

    return (

        <div className="calendar-container">

            {/* HEADER */}

            <div className="calendar-header">

                <div className="header-title">

                    <h1>
                        Space Calendar for Jira
                    </h1>

                    <p>
                        View your Jira issues by Start date
                        and Due date.
                    </p>

                </div>

                <div className="header-buttons">

                    <button
                        className="secondary-button"
                        onClick={goToToday}
                    >
                        Today
                    </button>

                    <button
                        className="secondary-button navigation-button"
                        onClick={previousMonth}
                        title="Previous month"
                    >
                        ❮
                    </button>

                    <button
                        className="secondary-button navigation-button"
                        onClick={nextMonth}
                        title="Next month"
                    >
                        ❯
                    </button>

                    <button
                        className="primary-button"
                        onClick={fetchEvents}
                        disabled={loading}
                    >
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>

                </div>

            </div>

            {/* MONTH TITLE */}

            <h2 className="month-title">
                {monthName}
            </h2>

            {/* LOADING */}

            {loading && (
                <div className="loading-message">
                    Loading Jira issues...
                </div>
            )}

            {/* ERROR */}

            {error && (
                <div className="error-message">
                    {error}
                </div>
            )}

            {/* CALENDAR */}

            <div className="calendar-grid">

                {/* WEEKDAYS */}

                {[
                    'Sun',
                    'Mon',
                    'Tue',
                    'Wed',
                    'Thu',
                    'Fri',
                    'Sat'
                ].map((day) => (

                    <div
                        key={day}
                        className="weekday-header"
                    >
                        {day}
                    </div>

                ))}

                {/* DAYS */}

                {calendarDays.map((day) => {

                    const dayEvents = getEventsForDay(day);

                    const isCurrentMonth =
                        day.getMonth() === currentMonth.getMonth();

                    const isToday = isSameDay(
                        day,
                        new Date()
                    );

                    return (

                        <div
                            key={formatDate(day)}
                            className={[
                                'calendar-day',
                                !isCurrentMonth ? 'other-month' : '',
                                isToday ? 'today' : ''
                            ].join(' ')}
                        >

                            <div className="date-number">
                                {day.getDate()}
                            </div>

                            <div className="events-container">

                                {dayEvents.map((event) => {

                                    const issueKey =
                                        event.extendedProps?.issueKey ||
                                        event.id;

                                    return (

                                        <button
                                            key={event.id}
                                            type="button"
                                            className="calendar-event"
                                            title={`Click to open ${issueKey}`}
                                            onClick={() => openJiraIssue(issueKey)}
                                        >
                                            {event.title}
                                        </button>

                                    );

                                })}

                            </div>

                        </div>

                    );

                })}

            </div>

            {/* FOOTER */}

            <div className="calendar-footer">

                Jira fields used:

                <strong> customfield_10015 </strong>
                (Start date) and

                <strong> duedate </strong>
                (Due date).

                <span className="footer-hint">
                    Click an event to open its Jira issue.
                </span>

            </div>

        </div>

    );
}

export default App;