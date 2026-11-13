# בלאקג'ק לחברים · Friends blackjack

שולחן בלאקג'ק בזמן אמת בין חברים, **בכסף משחק בלבד**. אין תשלומים אמיתיים.
מי שפותח שולחן הוא הדילר ומקבל קוד וקישור. שאר המצטרפים בוחרים כינוי וקופת פתיחה.

A realtime play-money blackjack table for friends. No real payments.
The person who creates the table is the dealer and gets a room code and link. Everyone else joins as a player, picks a nickname, and loads a starting bankroll.

## הרצה מקומית · Run locally

```bash
npm install
npm test
npm start
```

השרת מאזין על `0.0.0.0` ועל `PORT` (ברירת מחדל `4317`).
פתחו [http://127.0.0.1:4317](http://127.0.0.1:4317), צרו שולחן, ושתפו את הקישור בלשונית שנייה.

The server binds to `0.0.0.0` and `process.env.PORT` (default `4317`).
Open [http://127.0.0.1:4317](http://127.0.0.1:4317), create a table, and open the share link in a second tab.

## פריסה ב-Render · Deploy on Render

במאגר יש `render.yaml`: שירות ווב אחד (`runtime: node`, `plan: free`) עם `healthCheckPath: /health`.
חברו את הריפו ב-Render כ-Blueprint, או צרו Web Service ידנית:

- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`

Render מזריק `PORT`. האפליקציה מאזינה על `0.0.0.0:$PORT`.
השולחנות נשמרים **בזיכרון**. הפעלה מחדש, או הירדמות של תוכנית חינם אחרי חוסר פעילות, מוחקים שולחנות פתוחים. לערב ארוך עם חברים עדיף תוכנית בתשלום שלא נרדמת.

Tables are in memory. A restart, or a free instance spinning down, clears open tables.

## כללים שנבחרו · Rule choices

- 6 חפיסות, וקלף חיתוך אדום במיקום אקראי בין 60% ל־75% מהנעל. אם הוא יוצא באמצע היד מניחים אותו בצד, מסיימים את הסיבוב, ומערבבים לפני הסיבוב הבא. אם הוא הקלף הבא בדיוק בסיום הסיבוב, מערבבים מיד. הסיבובים ממשיכים אוטומטית; המושבים והיתרות נשארים.
- הדילר **עומד על 17 רך**. הקבוע `DEALER_HITS_SOFT_17` ב-`src/engine.js` הוא `false`.
- בלאקג'ק טבעי משלם 3:2. 21 אחרי פיצול משלם 1:1.
- תיקו מחזיר את ההימור. שחקן שנשרף מפסיד גם אם הדילר היה נשרף.
- פיצול פעם אחת, רק על אותה דרגה (מלך-מלך, לא מלך-10). אסים מפוצלים מקבלים קלף אחד. אחרי פיצול אחר אפשר להכפיל.
- הכפלה: רק כפעולה ראשונה על שני קלפים, בדיוק קלף אחד, וההימור מוכפל.
- אין ביטוח ואין כניעה. עד 7 שחקנים. הדילר לא משחק יד.
- הקלף הסגור וסדר הנעל לא נשלחים ללקוח. ניתוק באמצע התור עוצר את היד אחרי 20 שניות; רענון אותה לשונית מחזיר את המושב.

Six decks, red cut card at a random 60–75% depth. A cut card mid-round is set aside and the round finishes; the shoe is rebuilt before the next round. If the next card at the end of a round is the cut card, the shoe is rebuilt immediately. Rounds continue automatically and seats and balances stay. Dealer stands on soft 17. Naturals pay 3:2. One same-rank split; split aces take one card. Double is one extra card for twice the bet. No insurance or surrender. Up to 7 players. The hole card and shoe order stay on the server.
