;	PRTDEMO: show what the Epson FX-80 can do
;
;	Sends a page of print modes and a bit image to LST: through
;	BDOS function 5. A>PRTDEMO
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

bdos	equ	0005h
lstout	equ	5
esc	equ	27
cr	equ	13
lf	equ	10
endm	equ	0ffh		;end of the text (0 is a parameter)

	org	100h
	lxi	h,text
	call	send
;	bit image: ESC K with 8 rows of rising and falling teeth
	mvi	b,6		;lines of image
image:	push	b
	lxi	h,imghdr
	call	send
	mvi	c,30		;teeth per line
tooth:	push	b
	lxi	h,teeth
	mvi	b,16
tooth1:	mov	e,m
	push	h
	push	b
	mvi	c,lstout
	call	bdos
	pop	b
	pop	h
	inx	h
	dcr	b
	jnz	tooth1
	pop	b
	dcr	c
	jnz	tooth
	lxi	h,imgend
	call	send
	pop	b
	dcr	b
	jnz	image
	lxi	h,tail
	call	send
	ret

;	send the bytes at HL to the printer, up to ENDM
send:	mov	a,m
	cpi	endm
	rz
	mov	e,a
	push	h
	mvi	c,lstout
	call	bdos
	pop	h
	inx	h
	jmp	send

text:	db	esc,'@'
	db	esc,'E',esc,'W',1,'JSCPM  FX-80',esc,'W',0,esc,'F',cr,lf
	db	'CP/M 2.2 printing on an emulated Epson FX-80',cr,lf,lf
	db	'Pica, 10 characters to the inch.',cr,lf
	db	esc,'M','Elite, 12 characters to the inch.',esc,'P',cr,lf
	db	15,'Condensed, about 17 characters to the inch, for wide listings.',18,cr,lf
	db	esc,'E','Emphasized',esc,'F',', ',esc,'G','double-strike',esc,'H',', '
	db	esc,'4','italic',esc,'5',', ',esc,'-',1,'underlined',esc,'-',0,'.',cr,lf
	db	'E = mc',esc,'S',0,'2',esc,'T',' and H',esc,'S',1,'2',esc,'T','O.',cr,lf
	db	14,'Enlarged for one line',cr,lf
	db	esc,'!',8+32,'Master select',esc,'!',0,cr,lf,lf
	db	esc,'1'		;7/72" lines: image rows touch
	db	endm
imghdr:	db	esc,'K',224,1	;480 columns at 60 dpi = 8"
	db	endm
teeth:	db	01h,03h,07h,0fh,1fh,3fh,7fh,0ffh
	db	0ffh,7fh,3fh,1fh,0fh,07h,03h,01h
imgend:	db	cr,lf,endm
tail:	db	esc,'2',lf
	db	'The ASCII set:',cr,lf
	db	' !"#$%&''()*+,-./0123456789:;<=>?',cr,lf
	db	'@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_',cr,lf
	db	'`abcdefghijklmnopqrstuvwxyz{|}~',cr,lf
	db	endm
	end
