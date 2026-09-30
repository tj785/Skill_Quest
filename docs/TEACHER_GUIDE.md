# Teacher Guide

Character Quest turns your questions into building materials. Students answer questions at the **Quest Center**, earn XP, skills and blocks, and use those blocks to build a world together. You control the questions, the rewards and the world. You never need to write code.

The dashboard also has a built-in **Getting Started** page with these steps and buttons that take you to each one.

---

## Getting started in 10 steps

1. **Log in.** Use the account your administrator gave you, or choose **New teacher** on the login page and enter your school's teacher sign-up code.
2. **Create a class.** Top of the dashboard → **+ New class**. Each class gets its own world with a village, forest, desert, ocean and mountains.
3. **Add students.** **Students** → *Add a student* (name, username, password), or *Add many students* by pasting one per line: `username, password, name`. Or give students the **class code** shown at the top of the dashboard; they choose **Join a class** on the login page and make their own account.
4. **Check your subjects and skills.** Skills (Mathematics, Reading, Science, Writing, Programming, Problem Solving) are ready. Add your own under **Rewards → Skills**.
5. **Create questions.** **Questions → + Create question**, or **Import CSV** (see below).
6. **Set difficulty.** Levels 1 Basic, 2 Developing, 3 Challenge, 4 Advanced, 5 Master.
7. **Choose rewards.** The reward fields fill in from the difficulty. Change any of them to override.
8. **Assign questions.** Every question marked *Visible* appears in the Question Center. Group questions into an **Assignment** for a bonus reward.
9. **Have students log in.** They log in with their username and password and walk into the world.
10. **Watch the world grow.** Use **Dashboard**, **Students** and **Analytics** to follow learning, and **Enter the world** to see what the class is building.

## Creating a question

**Questions → + Create question**

| Field | Notes |
| --- | --- |
| Subject | Type or pick (Math, Reading, Science…). Used for analytics and subject achievements. |
| Topic | e.g. *Fractions*. Analytics shows accuracy per topic, so use consistent names. |
| Grade | Optional label. |
| Difficulty | 1–5. Changing it refills the rewards with that level's defaults (until you edit a reward yourself). |
| Question type | **Multiple choice** (pick the correct option), **True/false**, **Short answer** (capital letters and extra spaces are ignored; accept several answers with `|`, e.g. `antonym \| opposite`), **Number** (commas ignored; *Allowed difference* lets 3.14 count for 3.1416). |
| Explanation | Shown after a correct answer. |
| XP, Skill + points, Block + quantity, Coins | What the student gets the **first** time they answer correctly. |
| Time limit | Optional. If time runs out, the student simply tries again. |

Click **Save question**. It appears to students right away.

**Default rewards by difficulty** (you can change any of them per question):

| Difficulty | XP | Skill | Block | Coins |
| --- | --- | --- | --- | --- |
| 1 Basic | 25 | +1 | 5 Wood Planks (Common) | 5 |
| 2 Developing | 50 | +2 | 4 Bricks (Uncommon) | 10 |
| 3 Challenge | 100 | +5 | 3 Diamond Brick (Rare) | 20 |
| 4 Advanced | 250 | +8 | 2 Crystal Block (Epic) | 40 |
| 5 Master | 500 | +10 | 1 Starstone (Legendary) | 80 |

**How answering works for students:** wrong answers never take anything away; students can try again as often as they like. Rewards are given once per question. Level 4–5 questions show a special celebration screen. You'll see every try in the student's page.

**Hide or remove a question:** untick *Visible* to hide it (history is kept), or **Delete**.

## Importing questions from a spreadsheet (CSV)

**Questions → Import CSV.** Save your spreadsheet as CSV. The first row holds column names:

```
Question,Answer,Option A,Option B,Option C,Option D,Subject,Topic,Grade,Difficulty,XP,Reward Block,Block Quantity,Coins,Skill,Skill Amount,Explanation,Type
"What is 7 × 8?",56,,,,,Math,Multiplication,5,1,25,Wood Planks,5,5,Mathematics,1,,
"Which is a noun?",dog,run,dog,blue,fast,Writing,Grammar,5,2,,,,,,,,
```

- Only **Question** and **Answer** are required. Blank reward cells use the difficulty defaults.
- With options filled in, the question is multiple choice; put the correct option's text (or its letter A–D) in **Answer**.
- A number answer becomes a *Number* question; `True`/`False` becomes true/false; anything else is short answer.
- Use `|` in **Answer** to accept several answers.
- **Reward Block** uses block names such as `Stone Bricks`, `Glass`, `Gold Block`, `Diamond Brick`, `Crystal Block`, `Starstone`.
- Rows with problems are skipped and listed so you can fix them.

**Export CSV** downloads your whole bank in the same format (good for sharing with colleagues).

## Assignments

**Assignments → New assignment.** Give it a title (e.g. *Fractions Challenge*), pick the questions, choose **Whole class** or **Chosen students**, and set a bonus (XP, block, quantity, coins). When a student has answered **all** the assignment's questions correctly, the bonus is added automatically. Students see assignments with progress bars in the Question Center and in their Quests panel.

## Rewards, skills and achievements

- **Rewards → Give a bonus reward:** select students (or *Select everyone*) and send XP, skill points, blocks and/or coins, with a reason they will see. Good for participation, class events, real-world activities (a walk-a-thon, a science fair).
- **Skills:** add custom skills (e.g. *Teamwork*); questions and bonuses can raise them.
- **Achievements:** 10 are built in (First Steps, Builder, Master Builder, Mathematician, Science Explorer, Bookworm, Problem Solver, Quick Learner, Task Master, Scholar). Create your own: choose how it's earned (questions correct in a subject, difficult questions, blocks placed, total XP, assignments completed, or *Given by teacher*), the amount needed and a reward. Award any achievement by hand on a student's page.

## The world

**World** page:

- **Building permissions**
  - *Build anywhere* — anywhere except classmates' plots and village buildings.
  - *Personal area only* (default) — each student builds in their own 8×8 plot around the village (yellow outline in the game).
  - *Personal area + class project zones* — plots plus shared zones where everyone builds together.
  - *Read only* — explore, no building.
- **Gathering:** students can dig basic blocks (dirt, sand, stone, wood) from the land up to a daily limit. Turn off if you want questions to be the only source.
- **Unlock every region:** regions normally open by level (Forest 1, Desert 2, Ocean 3, Mountains 4).
- **Recommendations:** when a student is below 60% on a topic (3+ tries), the Question Center marks matching questions *recommended practice*.
- **Class project zones:** e.g. *Build the Future City*. Enter a rectangle (the village center is at 128, 128), and optional bonus XP per block placed there.
- **Buildings:** see what each student has built and remove a student's buildings if needed.
- **Reset an area:** puts the land back to how it was generated inside a rectangle. Student plot coordinates are listed for convenience.

Students can never remove a classmate's blocks (except inside project zones), and village buildings are protected.

### Entering the world yourself
Click **Enter the world** (top right). You have unlimited blocks, can fly (press **G**, Space up, Z down), and **World tools** lets you jump to any student who is online. Everything you build is saved like students' builds.

### Moderation (on a student's page)
**Pause (freeze) character**, **Turn off building**, **Send to their plot**, **Remove their buildings**, **Reset password**, **Delete student**. Everything is recorded in **Activity**.

**Mute chat** is on the student's page too, and on the Chat page.

## Quests and daily challenges (Quests page)
1. **+ Create quest**, give it a title and choose the type: *one-time quest*, *daily challenge* (resets every midnight) or *weekly challenge* (resets Monday). The reset uses the class **time zone** in Settings.
2. Add steps in order, e.g. *Answer 3 Math questions* → *Visit the Whispering Forest* → *Place 10 blocks*. Leave the student text blank to use a clear default.
3. Choose the reward (XP, coins, blocks and/or a cosmetic item). Students see their current step in the HUD and press **L** for the full list.
Progress only counts real actions checked by the server. Editing a quest restarts it for students part-way through.

## Special events (Events page)
A goal the whole class works toward, e.g. *Answer 50 questions as a class this week*. Pick the goal, the target, an optional end date, the reward each helper gets, and a structure to unlock (Crystal Fountain, Golden Champion Statue or Rainbow Arch, built at the x/z you choose). For real-world events (walk-a-thon laps, reading minutes) choose **points you add** and use **Add points**, optionally crediting a student. **Finish now** completes an event early.

## Approving builds (Approvals page)
Choose **Teacher approval** under World → Building permissions (or the button on the Approvals page). Students build in their own plot; new blocks have a gold tint and only the builder and you can see them. Students press **Submit build for approval** with a note. **Approve** makes the build visible to everyone at once; **Send back** returns the blocks to the student's inventory. Add feedback either way. Enter the world to look at a build first: you see pending blocks with the gold tint.

## Chat (Chat page)
- **Off** (default for new classes), **Safe phrases only** (students pick from 12 kind, pre-written phrases), or **Typed messages** (filtered for unkind words, links and phone numbers).
- Chat is only inside your class. There are no private messages.
- You see every message, including the original words of anything the filter changed. **Hide** removes a message from every screen. **Mute** stops one student from chatting.
- Messages you send in the world show as teacher announcements.

## Cosmetics shop
Students spend coins on shirts, hats, capes and titles (press **B**). Some items need a level; reward-only items (Legend Crown, Champion Cape, Class Helper and Event Champion titles) come only from you, quests or events. Give one under **Rewards → Cosmetic item**. Cosmetics never change XP or levels.

## Matching questions
In the question builder choose **Matching pairs** and type 2–8 pairs (item → match). Students pick a match for each item from a shuffled list; all pairs must be right to earn the reward. In a CSV, use Type `matching` and write the Answer as `Mercury=Closest to the Sun | Mars=The Red Planet`.

## Following progress

- **Dashboard:** students, questions completed, average accuracy, XP, buildings, achievements, blocks placed, levels, recent activity.
- **Students → a student:** level, XP, correct/incorrect answers, accuracy, per-topic accuracy (topics under 60% are flagged), skills, inventory, buildings, assignments, and every recent answer with the student's exact response.
- **Analytics:** accuracy by topic (weakest first), by difficulty, students who need help on a topic, and questions answered per day. Use it to decide what to assign next.
- **Questions:** accuracy and "solved by" for every question (a question almost nobody solves may be unclear).

## Exporting data

**Settings → Export student data** (JSON with each student's progress, answers, inventory, skills and achievements) and **Export question bank (CSV)**.

## Demo

The demo class **Grade 5 Adventure Class** (log in as `teacher` / `teacher123`) has students Alex, Jordan, Sam and Taylor (password `quest123`), 22 sample questions (including two matching questions), an assignment, a project zone, two example buildings, a multi-step quest, a daily and a weekly challenge, two class events and safe-phrase chat. Open a private browser window and log in as `jordan` to see the student side while you watch from the dashboard.
