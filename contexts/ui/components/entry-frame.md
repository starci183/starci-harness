# Entry frame

## Job

Hold one bounded entry task beside its contextual identity.

`EntryFrame` owns the page's main landmark, desktop split, form measure and mobile reading flow. The app supplies
the artwork and its content; the frame adds no copy or control. It serves account access, billing enrolment and game
account setup through the same structure.

## Choose

Choice `entry-frame.choose.role`: which owner holds an entry task. First matching row wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| entry | one form or outcome opens access to an app, with contextual artwork on desktop | `EntryFrame` | candidate: desktop context visibility, equal tracks and bounded form; compact identity below the split |
| app | a signed-in task needs persistent application navigation | `WorkspaceShell` with `Page` | `FE-APP-SHELL-1..6` |
| ordinary | a form belongs inside an existing page or overlay | `Form`, within that region's existing frame | judgement |

## Anatomy

The `artwork` and `intro` form one contextual pane on desktop. `identity` appears above the form below the desktop
split, where that pane is hidden. `tools` sits at the top trailing edge; `footer` remains below the vertically centred
form. `children` is the form or its outcome, at the same bounded measure in every state. The required `label` names
the main landmark. An outer `WorkspaceShell` or another main landmark does not wrap it.

Artwork composition is the app's asset work. A sanctioned `Freestyle` can crop and position decorative assets inside
the `artwork` slot; it owns none of the entry frame's tracks, form bounds or mobile visibility.

## Capability questions

`Page` and `WorkspaceShell` own normal application chrome; `Grid` owns relations among regions. None owns a full-height
entry task's conditional identity pane, bounded centred form, top tools and bottom support. No existing kind covers
that job. The role is a frame, so its named slots and form children are the frame's content boundary. A `Freestyle`
entry layout would leave the region's structure to each app, contrary to LAYOUT-2. Publishing this owner removes that
structural choice from app frames while retaining app-owned artwork and copy.

## Variants

There is one anatomy. Content roles fill its named slots; no variant chooses a different arrangement.

## Size

The form and intro measures are the entry-role ramps. The frame owns the desktop transition; the caller sets no size.

## States

The frame has no unresolved data of its own. Its form keeps its own loading, failure and outcome components; the same
slots remain in place. The package stories show ready, loading, failure and long copy in both families. At phone width
the context pane is hidden and identity stays visible; at desktop width the two panes are equal and the identity is
drawn by the artwork. Pictures remain subject to the Grammar's manual visual review.

## Owner split

The Grammar owns tracks, bounds, insets and responsive visibility. Knowledge chooses this role for an entry task.
The app supplies its form, translated copy, identity, legal navigation and artwork inside those boundaries.

## Rules

LAYOUT-2, RESPONSIVE-1, PADDING-7; CONTRIB-21 and the Grammar contribution laws.
