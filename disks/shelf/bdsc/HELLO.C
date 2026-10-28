/* hello.c: compile with  CC HELLO  then  CLINK HELLO, run with  HELLO */
#include "bdscio.h"

main()
{
	int i;

	printf("Hello from BDS C on DigitalRerun!\n");
	for (i = 1; i <= 5; i++)
		printf("%d squared is %d\n", i, i * i);
}
