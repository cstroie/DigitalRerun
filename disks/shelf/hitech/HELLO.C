/* hello.c: compile and link with  C -V HELLO.C, run with  HELLO */
#include <stdio.h>

int main(void)
{
	int i;

	printf("Hello from HI-TECH C on DigitalRerun!\n");
	for (i = 1; i <= 5; i++)
		printf("%d squared is %d\n", i, i * i);
	return 0;
}
