10 REM Guess the number
20 N% = RND(100) : T% = 0
30 PRINT "I am thinking of a number from 1 to 100."
40 REPEAT
50   INPUT "Your guess", G%
60   T% = T% + 1
70   IF G% < N% THEN PRINT "Higher."
80   IF G% > N% THEN PRINT "Lower."
90 UNTIL G% = N%
100 PRINT "Yes, "; N%; "! You took "; T%; " guesses."
