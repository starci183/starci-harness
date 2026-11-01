# Calendar day

## Job

Name one date's region without selecting a date.

## Choose

Choice `calendar-day.choose.role`: who owns a date shown by an interface. First matching row wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| select | choosing a date is the task | `Calendar` or the form's date picker | vendor keyboard and selection behavior |
| region | a schedule or calendar cell needs a passive date heading | `CalendarDay` | native time and current-date semantics |
| prose | a date is ordinary narrative or metadata rather than a calendar region | existing text or relative-time owner | judgement |

## Variants

There is no selection mode. The date-only value supplies the number; `isToday` reports the application's authoritative
current date, rather than selecting a theme tone.

## Size

The calendar heading uses the shared metadata ramp. It takes no size or paint prop.

## States

The required localized label names the full date. The current date has `aria-current="date"` and its native emphasis.
Cell commands stay separate and retain their own focus and pending states.

## Owner split

Grammar owns the native time element and date emphasis. Knowledge distinguishes a passive region heading from a
selection control. The app supplies the date, translated label and current-date fact.

## Rules

LAYOUT-2, TRUTH-1, ACCENT-1; CONTRIB-21 and the Grammar contribution laws.
